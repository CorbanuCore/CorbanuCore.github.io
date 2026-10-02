# Include the published Kioxia / Nikkei pair

The user's correction locks this bounded task: the published-idea portfolio must include the Kioxia / Nikkei recommendation at its stated 3% long and 8.5% short weights. The word proposed is not an exclusion criterion for a published model position. Conditional later additions and exit rules still require a published update.

Current code: assets/portfolio/ledger.json excluded this pair in bookNote. The arithmetic and unified table are already ledger driven. The article identifies the xyz:KIOXIA / xyz:JP225 perpetual alternative, but quotes cash-market reference levels in different units. Its metadata records publication at 2026-09-16T00:00:00Z. Native hourly candles establish matching publication-time opens. Kioxia's venue quote switches to a three-for-one basis at the 28 September 08:00 UTC candle; compare the preserved native observations with the company's split notice. A perpetual model must disclose continuous economic exposure across contract relisting, rather than claim actual held contracts or cash-share fills.

1. Add both model positions and preserve quote provenance.
   - Use the stated weights with native publication-time opening quotes for the article's perpetual alternative.
   - Express Kioxia's entry and earlier historical quotes on the current split-adjusted basis; preserve raw entry quotes and the adjustment source.
   - Add both dated mark paths to existing observations without overwriting other positions' quotes or dates. Refresh current native marks through the existing collector.
2. Keep the table dynamic and facts comparable.
   - Include both holdings in counts, weights, P&L and metric coverage with no ticker-specific presentation branch.
   - Preserve comparable dated consensus P/E from the article. Do not substitute FY1-to-FY2 growth or an expired funding forecast for the table's existing definitions.
   - Retain these dated source rows through the current generic statistics collector until matching newer sources exist.
3. Verify and publish.
   - Test source weights, article hashes, split continuity, both sides' P&L contribution and missing-data coverage.
   - Run website and browser checks, publish under the writer lock, wait for Pages and compare live files.
   - Verify seven current positions, eight opening/resize events, table values, source notes, desktop/mobile layout, and active refresh timers.

Task Node remains unavailable. No trading, model roster, research formula, or private generator change is required. This document and private delivery evidence record completion.

Status: implementation complete. All 28 website tests pass, including native reference provenance, split continuity, both legs' P&L contribution and unavailable-field coverage. The existing browser tests still pass for arbitrary changing holdings. The actual seven-position preview reconciles all ten weighted values, source dates and coverage on desktop/mobile, with no page errors or horizontal overflow. The current private collector successfully captures both new native marks and retains their dated P/E observations. Publication and live verification are recorded in the private delivery evidence.
