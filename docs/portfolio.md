# Portfolio tracker

`/portfolio/` follows an explicit published ledger at `assets/portfolio/ledger.json`. Dated observations live at `assets/portfolio/marks.json`. Page styling extends the shared Market Lens stylesheet; no new frontend dependency is required.

## Ledger

The ready ledger uses `schema: corbanu.portfolio.v1`, `state: ready`, positive `initialCapital`, UTC `inception`, `positions` and time-ordered `events`. It stays in `state: pending` until the tracker identity and sizing are confirmed. A pending book displays an honest empty state, without a synthetic P&L line or inferred positions.

Every position declares `id`, `symbol`, `name`, `venue`, optional market `href` and `articleHref`. Native perpetual marks additionally declare `markAdapter: hyperliquid` and the exact `rawSymbol` (for example `xyz:CBRS`). Felix spot marks declare `markAdapter: felix`, exact token `rawSymbol`, and `underlyingTicker`; the collector uses the actual USD token price and venue `updatedAt`, checking both token and underlying identity. Other instruments use their recorded, individually dated observations until a matching source adapter is supplied. Do not replace a spot instrument with a perpetual or another token representing the same stock.

A trade event contains unique `id`, `positionId`, `type: trade`, UTC `at`, signed `quantity`, positive `price`, optional signed `targetWeightPct`, nonnegative `fee`, `note` and research `href`. Positive quantities buy; negative quantities sell. A cash event contains `type: cashflow` and signed `amount` in the same unit as capital, recording actual funding, dividends or other specified investment cash flows. Deposits and withdrawals require an explicit capital methodology; do not represent them as investment gains.

Capital, quantities and cash flows must share a consistent unit. A book maintained as capital fractions can use `initialCapital: 1`: an initial 3.5% long at price P has quantity `0.035 / P`. This expresses a normalized capital basis; it makes no claim about actual dollar account size. Confirm the denominator and weights before populating a book.

Trade events determine quantities and statuses. First entry is **Opened**, an increase is **Added**, partial reduction is **Cut**, full closure is **Exited**, and crossing from long to short or vice versa is **Reversed**. These describe the last published model action and carry its date. Published sized ideas enter the reference model even when the article calls them proposed. Conditional later additions and exit rules do not create changes until a published update states them. Model entries do not establish actual account fills.

## P&L and observations

Average entry is quantity-weighted on additions. Reductions realize the gain or loss on the closed quantity; remaining quantity retains its cost basis. Reversals close the old side and start the residual side at the reversal price. Cumulative P&L equals realized plus unrealized plus recorded cash flows minus recorded fees, divided by initial capital. Period buttons change the visible window without rebasing performance. `costsNote` must identify omitted funding, fees, borrow, dividends or execution costs as applicable.

The marks document uses `schema: corbanu.portfolio-marks.v1` and increasing unique `observations`, each with UTC `at` and `marks`. Each mark is keyed by position ID and carries positive `price`, UTC `observedAt`, and `source`. Future marks and marks predating the latest position change cannot value that position. A missing active mark makes total P&L unavailable; it never becomes zero. An exited position needs no continuing mark and keeps its realized P&L.

History uses dated observations and preserves incomplete gaps. There is no fabricated pre-inception history or backfilled candle series presented as a historical mark series. Any agreed historical reconstruction belongs in `historyNote`, with its actual price convention and dates.

The Kioxia / Nikkei pair uses the article's stated 3% long and 8.5% short weights and its named perpetual alternative. The entry quote is the native hourly opening price at the article's publication timestamp, since the article's yen cash reference is not a quote for the USD-settled perpetual. Raw quotes and matching native candles are preserved in `assets/portfolio/reference-quotes.json`. Kioxia's entry and pre-relisting closes are divided by three onto the current split-adjusted quote basis; model quantities are sized on that basis. The model preserves economic exposure across the relisting without claiming actual contract settlement or re-entry fills. Each position can declare its dated `historicalPriceAdjustments`; presentation and live mark collection stay generic.

The browser refreshes native `markPx` every 30 seconds while visible and online, batching by venue namespace. It validates every requested native position before replacing a snapshot. Failure retains the prior dated valuation. The live point is temporary; durable history comes from published observations. The page reloads ledger/history every five minutes. Recorded non-native marks retain their original dates and do not get labeled live.

The private site publisher collects durable native perpetual and Felix token mark observations on every newly generated run, including its fifteen-minute AI run. Collection happens before taking the public writer lock. Publication merges concurrent observation histories and keeps the writer's existing observation when timestamps match. An observation collected against a different ledger fingerprint cannot overwrite the current book. This integration must be installed together with the confirmed ledger. Other instruments require matching dated source observations; the collector retains those dates and reports missing coverage.

## Checks

```sh
node --test tests/portfolio_test.mjs
CORBANU_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/portfolio_browser.mjs
```

Browser checks use clearly synthetic test fixtures, validate native mark selection against a different mid price, retention after a failed refresh, filters, chart keyboard controls and mobile layout. They do not read private accounts or submit transactions.

## Aggregate statistics

The unified Statistic / Longs / Shorts table below Positions uses `assets/portfolio/statistics.json` (`corbanu.portfolio-statistics.v1`). Only current positions enter the averages. Each side uses absolute published capital weights; a book without published weights falls back to entry-cost weights. Each metric is an arithmetic weighted average over its available values, with missing position/weight coverage and actual source dates disclosed. Missing values and explicit n/m are excluded, while valid zero and negative growth/revisions remain meaningful values. Exited positions never enter the averages.

The compact snapshot copies only matching issuer target rows from Market Lens, preserving `BEST_PE_RATIO`, consensus 1BF sales/EPS growth versus trailing reported values, 28-observation EPS revisions as a percentage of price, annotations and per-metric observation dates. Any holding without matching consensus data remains outside the affected fundamental average. Earnings revision is not percentage growth in EPS.

For a position outside Market Lens's separately locked instrument roster, the collector retains matching previously recorded statistics with their original dates. The Kioxia / Nikkei P/E observations are the article's 15 September next-12-month consensus values. Its FY1-to-FY2 growth is not substituted for forward growth versus trailing twelve months, and its expired funding forecast is not substituted for a current forecast. Unavailable fields remain missing with position and weight coverage disclosed.

Funding uses the existing annualized seven-day model forecast, with its own source date and model. Positive rates are paid by longs and received by shorts; the side carry display reverses the sign for longs. Spot tokens contribute structural zero perpetual funding across their side's weight. Forecast carry never enters tracker price P&L. Source failures retain valid dated statistics, and a failed browser snapshot reload retains the last successful statistics independently of the P&L refresh.

The publisher generates statistics after issuer payload generation and publishes on its existing schedules. Delayed output cannot replace a newer statistics snapshot or cross a changed ledger fingerprint. Publication receipts verify the statistics snapshot live as well as marks.

The table body, side counts, published-weight totals, dates and source notes are generated from the current book and statistics document. There are no ticker-specific branches in its presentation. Browser tests replace the fixture book with a different instrument and weight to verify that both the totals and coverage update. Individual missing/n/m explanations appear once in expandable source notes, grouped by affected fields.
