# Unified portfolio statistics table

The user's follow-up locks this bounded change: remove issuer-specific assumptions from presentation, double-check facts, and present portfolio aggregate statistics in one table below Positions. Preserve the ledger, weights, quantities, source fields and arithmetic definitions.

Current code: portfolio/index.html has separate long/short cards; assets/js/corbanu-portfolio-page.js renders them from aggregateStatistics in assets/js/corbanu-portfolio.js. Holdings and statistics already come from ledger.json and statistics.json; they are not static ticker markup. The publisher exports matching issuer metrics and their original dates.

1. Present one Metric / Longs / Shorts comparison table.
   - Build cells and totals from the current ledger and snapshot; no issuer names, counts, dates or values are embedded in page logic.
   - Show metric-specific weight coverage and dates; move repeated missing-data explanations to dynamically generated source notes.
   - Match site typography/colors and remain usable on mobile.
2. Audit facts and dynamic behavior.
   - Recompute individual fields from filtered Bloomberg cache inputs and the funding forecast parquet, then independently reconcile weighted totals.
   - Preserve the forecast label, official funding sign convention, revision denominator/window, negative/zero observations and n/m exclusions.
   - Test changing fixture holdings and weights, new instruments, exits and unavailable snapshots; do not use live performance as a fixture.
3. Publish and verify.
   - Run website and browser tests, inspect changed files, publish through the single writer lock.
   - Wait for Pages, compare public bytes, and check the real book on desktop/mobile.

Task Node remains unavailable; this plan and private delivery evidence record scope and completion. No private generator or trading code change is required.

Status: implementation complete. All 25 website tests and the expanded portfolio browser checks pass. The browser test adds an arbitrary new holding and verifies automatic recalculation; actual-book desktop/mobile previews pass. Twenty source fields match independent recomputations from Bloomberg cache inputs and the funding forecast parquet; all ten aggregate values reconcile to ledger weights. Funding sign convention checked against official Hyperliquid documentation. Source dates remain visible and are not represented as newly retrieved Bloomberg observations. Publication/live verification in progress.
