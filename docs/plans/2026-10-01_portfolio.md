# Corbanu portfolio tracker

The user's request on 1 October 2026 locks the scope: add `/portfolio/`, matching the existing Corbanu UX, with a marked P&L line as a percentage of capital, current positions, and dated position changes such as added, cut and exited.

## Current code and inputs

The public site is static HTML, CSS and JavaScript. `markets/index.html` and `assets/css/market-lens.css` supply the existing black/lime palette, typography, header, search and table conventions. NavStrategies' `scripts/market_lens/build_market_pages.py`, `build_posts.py` and `build_onchainstocks_page.py` regenerate navigation. The single publishing checkout owns public pushes.

Published articles contain tracker entries and some capital weights, including CBRS/CXMT and Apple/Oracle/SK hynix. They are not a complete confirmed ledger: proposed trades and conditional future changes must not become executed changes. The user has been asked to identify the portfolio and capital/sizing. Account holdings and private journal material are outside this website task.

## Tasks and acceptance criteria

1. Build the page and event-based calculation using an explicit ledger contract.
   - Reuse shared site styling and market search; support desktop and mobile.
   - Show cumulative P&L divided by initial capital, current marked exposure, individual contribution, entry/mark prices, status and dated activity.
   - Add, reduce and close positions without resetting prior realized gains; treat long and short quantities correctly.
   - Show missing data explicitly; never substitute zero for unknown holdings, marks or capital.
2. Connect the confirmed tracker ledger and market observations.
   - Use confirmed entry/change dates, prices and quantities; preserve article links and source provenance.
   - Refresh perpetuals using native `markPx`; retain the last dated complete snapshot when live refresh fails.
   - Persist dated observations for history through the existing publication workflow; disclose any historical reconstruction and excluded costs.
   - Do not change strategy definitions, sizing rules or live execution.
3. Integrate and deliver.
   - Navigation survives generated page refreshes.
   - Calculation fixtures cover shorts, additions, partial reductions, exits, missing marks and time ordering.
   - Browser checks cover chart interactions, position filters, activity, missing-data states and narrow viewports.
   - Run existing website checks, publish with the single writer lock, and compare live content with committed files.

Task Node is unavailable in this environment; the working plan records scope and delivery evidence directly.

## Status

The page, event-based P&L calculation, statuses, responsive layout, chart controls and dated last-good retention are implemented. The private publisher integration collects native perpetual and Felix token observations before the writer lock, merging history without allowing a delayed run to overwrite a changed ledger.

Validation: all 22 website tests pass, all 54 relevant private pipeline tests pass, and the portfolio browser check passes for native mark selection, realized/unrealized totals, additions/cuts/exits, filters, chart keyboard controls, source failure, mobile layout and pending setup. Browser previews contain explicitly labeled synthetic test data only.

The actual tracker ledger remains pending. The product specification identifies the capital-weight spreadsheet as its source of truth; no corresponding ledger was found in the checked workspace paths. The user's source/capital clarification is still pending. Production publication and installation of the updated generator are not done. Existing production timers and generator revision remain in place.
