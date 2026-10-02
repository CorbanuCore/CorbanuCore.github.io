# Portfolio aggregate statistics

The 2 October user request locks this bounded website change: add long and short aggregate statistics immediately below Positions, matching Corbanu UX. Preserve the published ledger, weights, quantities, P&L methodology, and trading behavior.

Current code: portfolio/index.html supplies the page, assets/js/corbanu-portfolio.js computes the book, assets/js/corbanu-portfolio-page.js renders it. NavStrategies navstrategies/data_updates/corbanu_portfolio.py and scripts/market_lens/publish_market_lens.sh record and publish marks. Market Lens issuer payloads contain target fundamentals, per-metric dates, annotations, and dated seven-day funding forecasts.

1. Publish a compact statistics source alongside existing portfolio observations.
   - Copy exact held instrument target fields, never peer averages or mismatched contracts.
   - Preserve BEST_PE_RATIO, consensus sales/EPS growth, 28-observation EPS revisions as % of price, and seven-day funding forecast values and dates.
   - Spot holdings contribute structural zero to perpetual funding; missing fundamentals and explicit n/m remain disclosed.
   - Generate after issuer page refresh; retain valid dated source data on retrieval failure and merge only against the current ledger.
2. Add published-weight arithmetic averages separately for current longs and shorts.
   - Exclude exited positions; use absolute stated capital weights and preserve valid zero/negative growth and revisions.
   - Renormalize each metric over covered weight; show position and weight coverage, missing/n/m components, and oldest/newest actual source dates.
   - Label forecast funding and show side carry with correct long/short signs; do not add forecast carry to realized P&L.
3. Match the page UX and deliver live.
   - Place responsive Longs/Shorts cards below Positions, with P/E, sales/EPS growth, funding and EPS revisions.
   - Test differing weights, missing/n/m values, zero values, exits, source dates, contract identity, and failures.
   - Publish through the single writer, verify deployment and live bytes, and check desktop/mobile plus automatic statistics publication.

Task Node is unavailable in the installed skills/tools; this working plan and private delivery evidence record the bounded task directly.

Status: implementation complete; 58 relevant private tests and 25 website tests pass. Desktop/mobile previews, current book arithmetic, synthetic browser checks, and source-failure retention pass. Live publication and automatic refresh verification are in progress. Funding is the existing seven-day annualized model forecast, not a historical average or a guaranteed return. P/E is the arithmetic weighted average matching existing Market Lens averages. No new research source or execution policy is introduced.
