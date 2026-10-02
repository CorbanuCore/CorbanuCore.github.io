# Realized book beta from native daily prices

The user locks this bounded change: calculate and display realized whole-book beta to TradeXYZ S&P 500 (xyz:SP500) and Hyperliquid Bitcoin (BTC), using daily prices over trailing one and three months. If three months of book history are unavailable, show available one-month history. No exogenous benchmark dataset or change to published positions, weights, execution, or strategy formulas is authorized.

Current code: assets/js/corbanu-portfolio.js values the published event ledger; assets/js/corbanu-portfolio-page.js loads recorded marks and renders P&L/statistics. The book begins 4 September. Positions and marks include Kioxia's split-adjusted price basis and individually dated Felix spot observations. The browser already queries Hyperliquid's public info endpoint. Native candleSnapshot supports matching UTC 1d closes for both benchmarks and the book's perpetuals.

1. Compute synchronized daily realized returns.
   - Fetch completed 1d candles for the ledger's native instruments and both benchmark identifiers; deduplicate requests and bound them to inception or 91 days.
   - Value published historical quantities and cash flows at each daily close; use timestamp-based ledger quote adjustments and recorded dated spot quotes. Never use future quotes or substitute unknown marks with zero.
   - Use whole-book NAV = initial capital plus cumulative P&L, including unallocated capital. Regress adjacent 24-hour NAV returns on matching benchmark price returns with an intercept: beta = centered covariance / benchmark variance.
2. Show one-month and available three-month measurements.
   - One month is 30 days; three months is 90 days. Exclude incomplete current-day candles, disclose actual dates and paired daily-return counts.
   - Show the 90-day row only when both regressions have all 90 paired returns; otherwise use the available 30-day history and state the fallback.
   - Show negative and zero betas accurately, R-squared where defined, missing-data reasons and retained source dates after retrieval failure.
   - Place a compact responsive book-beta table below the P&L chart; leave the existing long/short fundamentals table ledger driven.
3. Verify and publish.
   - Tests cover known regression slopes/intercepts, negative/zero beta, variance failure, daily gaps, partial days, historical entries/changes, spot quote dates, and a split within a daily candle.
   - Independently reconcile the actual book against captured native daily responses; browser-test native requests, fallback, refresh retention and mobile layout.
   - Publish source changes through the writer lock, verify Pages and live bytes/browser values, restore existing timers and record delivery evidence.

Task Node remains unavailable. No private generator/runtime change is necessary. Funding, fees and borrowing omissions follow the existing price-only tracker; benchmark contracts are disclosed and are not presented as spot indexes.

Status: implementation complete. All 33 website tests and both portfolio browser suites pass. An independent cash-account reconstruction and OLS regression reconcile every available daily NAV and both benchmark regressions. The actual-book preview verifies 27 paired returns from 4 September through 1 October, S&P beta +0.028584593685 and BTC beta +0.012289921245, 1M fallback, retained spot disclosure, eight deduplicated native-only daily requests and mobile layout with zero page errors. Publication and live verification are recorded in private delivery evidence.
