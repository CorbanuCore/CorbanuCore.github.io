# Corbanu Newsletter — Product Specification

**Version:** 1.0 draft
**Owner:** GoodAlexander (PM)
**Analyst:** Travis Good
**Status:** For review

---

## 1. Product Definition

The Corbanu Newsletter is the premier publication on on-chain speculation. Every article is a trade: an entry, a thesis, and a live tracker ID. Users come to Corbanu for actionable trade ideas expressed in on-chain instruments, delivered by two authors who use AI to compound capital and give readers the tools to do the same.

**Core principle: trades determine the value of all content. There is no content without trades.** The quality and frequency of trades ultimately determine the quality of the product. Everything else in this document — pipelines, pages, automation — exists to package and distribute trades.

Corbanu is a self-standing brand (corbanu.com), separate from the personal GoodAlexander X account. The sister product, Corbanu Terminal (a Codex-fork coding agent for brokerage integration), is a separate product with its own spec; it appears here only as an API consumer (§10).

---

## 2. Audience & Positioning

**Primary audience:** followers of the GoodAlexander X account. ~93% male power traders active on Interactive Brokers, Hyperliquid, Binance, and Robinhood. They engage with crypto content and actionable trading information; behavior and preferences overlap with the Citrini audience.

**User story:** "I am trading on Hyperliquid, Binance and Robinhood and I want to trade stocks on-chain and connect my AI agent to Corbanu to make it work better."

**Positioning constraints:**
- Not market commentary. No writing for the sake of writing. No daily filler.
- Not a quant-signal feed. Readers should never feel they are implementing a quant strategy; they engage with compelling narratives backed by (invisible) quantification.
- Not paywalled. Content is free; monetization is ref links and sponsorships (§11).

---

## 3. Instruments & Coverage Universe

**Hard rule: no positions that are not on-chain.**

| Asset class | Primary expression | Secondary / leverage |
|---|---|---|
| Stocks (incl. AI/memory names) | Tokenized stocks (Binance, Robinhood on-chain listings; already surfaced on asset profile pages) | Trade[XYZ] stock perps on Hyperliquid — also key ref-link inventory |
| Commodities (gold, silver, oil, copper, natgas) | On-chain perp markets | — |
| Crypto (BTC, ETH, SOL, XRP + coverage) | Spot / perps | Perps (incl. market-neutral RV) |

**Coverage split:**
- **GoodAlexander (PM):** on-chain stocks, crypto, commodities (Bitcoin, gold, oil, macro).
- **Travis Good (Analyst):** AI stocks, including memory stocks.

Current universe (per existing site): ~30 stocks (AAPL, AMD, AMZN, BE, CBRS, COIN, CRCL, CXMT, DRAM, EWY, GOOGL, INTC, META, MRVL, MSFT, MSTR, MU, NBIS, NVDA, PLTR, SKHX, SKHY, SMSN, SNDK, SOXL, SP500, SPCX, TSLA, XYZ100), 6 commodities, 4 crypto majors.

---

## 4. Portfolio: The Book

- **One book.** GoodAlexander is portfolio manager of record; Travis is analyst. No separate books. (A future fully-autonomous AI PM trading e.g. FX would be a separate book — out of scope.)
- **PM discretion is absolute.** No codified exposure constraints in v1. Sizing is set by the PM; there is no gradual scaling — "there is only the position."
- **Position framing:** target positions expressed as **% of capital**, maintained in a spreadsheet that is the book's source of truth (PM requirement).
- **No stops.** Exits are discretionary. The commitment to readers: when a position is exited, the originating article is updated.
- **Structural alignment rule:** positions should not be initiated against a non-firing systematic signal (see §6). Signal-aligned entry/exit thresholds are a candidate premium/API data product.
- **Earnings rule:** any held stock must receive a published earnings preview before it reports. No going into earnings un-previewed.
- **Portfolio aggregates** (e.g., "long book at X× sales vs. short book at Y×") should be computable from the book and passed into content where relevant (not applicable to crypto positions).

### Analyst coverage standard: "Ramped"

Every stock with a buy or sell entry must be ramped before publication. Ramped means:

1. **Product set:** current products known; what is driving the stock's story.
2. **Competitive environment:** how those products track competitively; is demand rising such that consensus EPS/revenue growth can be underwritten.
3. **Primary sources consumed:** most recent earnings transcripts and management roadshows read; what matters for the stock is known.
4. **Differentiated technical research:** a first-hand technical view of the product itself — not a meme channel check. E.g., "this memory product is better relative to its valuation, pricing is strong, and pricing power persists."

No stock enters the book un-ramped.

---

## 5. Editorial System

### 5.1 Trade lifecycle

1. **R&D / backtesting (invisible).** Systematic strategies (§6) run daily, low churn, and define the possible trade set. Backtests are table stakes — valuation, GARP, data tracking, funding rates are quantified but never presented as the product.
2. **Trade journal.** An internal, encrypted, collaborative document. Both authors log flowing market reflections and coverage-universe thoughts. The journal is the mechanism that converts human market read into systematic input: journal entries are distilled into market-mosaic points on the universe.
3. **Trade generation.** A trade idea = systematic signal(s) + journal mosaic. When something screens against the journal, the PM puts it on. Sizing is human (v1).
4. **Agentic research packet.** Every trade gets trade-specific automated research: Google Trends, the token's repo and roadmap, founder tweets, relevant news. Packaged as an appendix matched to the trade.
5. **Article.** Human-written (AI-assisted polish permitted). Clear thesis articulation, charts (charts are essential), signal-block references (§6.2), research-packet appendix, ref links, tracker ID.
6. **Publication** across surfaces (§7).
7. **Maintenance.** Earnings previews for held names; exit = article update; tracker status flips.

### 5.2 Article types

1. **Trade initiation** — the core unit. Entry, thesis, sizing (% of capital), tracker ID, venue links.
2. **Exit / position update** — updates the originating article; flips tracker status.
3. **Earnings preview** — mandatory for held names into their report.

### 5.3 Cadence

Event-driven, aligned to trading cadence. Multiple articles in one day if multiple trades go on; zero if nothing trades. Never force content.

### 5.4 Article anatomy

- Thesis (narrative-first, human voice)
- Charts
- Signal-block reference ("what's in the signal," §6.2) — referenced cleanly, not dumped
- Portfolio context / aggregates where relevant
- Agentic research packet appendix (Trends, repo, roadmap, founder activity, linked news articles)
- Ref links (venue + any referenced product)
- **Tracker ID footer:** trade status (LIVE / CLOSED) at the bottom of every article

---

## 6. Content Machine: Systematic Strategy Drivers

All three engines are **built and running**:

1. **Stock backtest** — indicators include valuation, sales growth, earnings revisions (GARP-style factors + data tracking + funding rates).
2. **Coin relative-value backtest** — market-neutral relative value based on perps.
3. **Macro asset backtest** — gold, silver, oil, bitcoin, eth; heavy alt-data tracking (e.g., retail gold-bar demand), with signals mapped at the individual data-stream level.

### 6.2 Signal blocks (new build)

A **signal block** is a structured representation of a signal's contents (e.g., "GOLD: retail bar demand ↑, valuation percentile X, revision momentum Y") that is passed into article generation. Purpose: articles reference what's inside the signal in a clean, narrative-compatible way — the content references the signal without becoming a signal dump. Especially important for macro assets with rich data-tracking inputs.

**Requirement:** an interface between the strategy engines and the editorial pipeline that emits signal blocks per asset, consumable by both human authors and AI drafting tools.

---

## 7. Product Surfaces

### 7.1 corbanu.com — canonical article + asset pages

Articles **must** live on the website (not Beehiiv-hosted pages), because the site is where tracker components render and where first-party analytics run (§12).

**Asset pages — existing state** (template: corbanu.com/meta):
- Instrument selector across the full universe
- Spot vs. perp total-return chart incl. realized funding, peer rebasing, options-implied probability fan
- Weighted peer basket table: 24h/7d change, T+7d funding APR, forward P/E, sales growth, EPS growth, 28d EPS revisions/price, 24h perp liquidity
- Earnings probability & historical structure payouts (listed options, volume-screened structures replayed around prior earnings)
- AI-generated (Kimi K3) earnings transcript briefings with historical reaction moves, chained quarter context

**Asset pages — gaps (new builds):**
1. **Per-stock financial models.** Buy-side-style historical financial models, consumable as a mirror of a spreadsheet. Today only aggregates exist; no historical financials per name.
2. **Sell-side consensus layer.** Wall Street consensus across key points (estimates, targets, ratings). **Open item: data source selection** — evaluate options (e.g., estimates vendors) for cost/licensing fit.

### 7.2 Beehiiv — email distribution

Beehiiv is the email list and delivery layer only. Email content corresponds directly to site articles. Subscriber management and signup flows live here.

### 7.3 X Articles

Full trade ideas republished as X Articles (possibly lagged vs. site/email), always with newsletter signup links. Purpose: maximize breadth.

### 7.4 Corbanu X account (automated) — see §8

### 7.5 YouTube show + clips

Weekly show: what we did over the last week and why — what's in the market, what's exciting, what has us taking positions. Not a rant format; not every trade covered. Requires a **clipping pipeline** to cut the show into short-form distribution.

---

## 8. Automated X Account

**Mandate:** only ever post things material to the liquid on-chain universe. Differentiated from other news accounts by first-party-source discipline: "we only say things that move markets."

**Brand decision:** Corbanu is a separate, self-standing X account (not the personal GoodAlexander account). GoodAlexander amplifies the highest-signal Corbanu posts, solving cold-start distribution while keeping the personal account curated.

### 8.1 Pipeline

**Inputs (v1):**
- earningscall.biz — new earnings transcripts
- Bamsec pipeline — recent filings/coverage uploads across the target universe
- Management roadshow / industry conference transcripts
- Central bank scraper (Fed etc.)

**Inputs (later):**
- YouTube/podcast transcript pipeline (management interviews are market-moving and underserved)
- X API monitoring of material-poster accounts (founder/CEO accounts that post material updates)

**Processing:**
1. Extract the most **market-moving elements** — explicitly not transcript summaries.
2. Overlay with live attention: weight by current volume/price action (e.g., SNDK −10% on heavy volume elevates anything SNDK said on the road).
3. **Automated materiality gate:** (name's liquidity/volume) × (likely materiality of content) × (recency — must have just come out). Anything above threshold gets a tweet.
4. **Auto-post. No human approval queue.** Volume is whatever clears the bar; naturally spikes during earnings.

**Risk mitigation (recommended, PM to confirm):** a confidence threshold during the first months routing low-confidence extractions to human review — the tail risk of an automated account is a market-moving misquote of a CEO on a brand carrying trade recommendations.

**Scope:** coverage universe + liquid on-chain stock universe.

---

## 9. GoodBrief (internal — compliance-constrained)

A recurring automated system that aggregates a large volume of Bloomberg news outputs into a single report consumed by the PM. Mechanics: intern downloads terminal PDFs → automated summarization → report.

**Purpose:** PM ramp only — ensures the trade journal is informed by the best available information.

**Hard constraint: no redistribution of Bloomberg content into any Corbanu surface.** GoodBrief output never appears in articles, tweets, or the site.

---

## 10. Corbanu Terminal API (interface requirement)

The Terminal (separate product, separate spec) consumes Corbanu via API:
- **Page content** — asset pages, articles, briefings (everything humans see free on the web)
- **Trades feed** — the live portfolio: tickers, direction, % of capital, open/closed status

**Access model:** content is free for humans on the web; **agent access requires a paid Corbanu Terminal coding plan.** Candidate premium extension: signal-aligned entry/exit thresholds.

**Requirement on this product:** all site content and tracker data must be structured/machine-readable enough for the API to serve it. Article schema, tracker state, and portfolio state need clean underlying data models from day one.

---

## 11. Monetization

**Model:** advertising + referral, never charging for content.

**Ref-link inventory:**
- **CEXs (anchor):** Hyperliquid, Binance; plus OKX, Bitget, and every obtainable CEX program
- **Perp venues:** Trade[XYZ] and equivalents — linked contextually from trade ideas ("put this on here")
- **Infrastructure:** Hetzner, Vultr (agent-hosting audience)
- **Products:** any product written up in a trade idea that has a referral program
- **Cross-promo:** other newsletters, when we find cool shit
- **Sponsorships:** accepted, but ref-links are the priority

**Ref-link registry (new build):** a central registry resolving every venue/product mention to its reffed URL, applied consistently across articles, asset pages, emails, and X. Every trade idea programmatically resolves to its tradeable venues, each with the correct link.

---

## 12. Data & Analytics (Corbanu as alt-data source)

The site and social surfaces double as proprietary data inputs to the trading process:

1. **Ticker-level retail interest:** first-party web analytics on which tickers/pages the audience is engaging with — an internal alt-data stream feeding the strategy engines.
2. **Tweet engagement tracking** on ticker-relevant posts — specifically like/engagement data revealing whether high-signal accounts are engaging.
3. Standard digital-media health metrics: time on site, churn.

This is a stated product goal: data tracking that informs Corbanu's own positions.

---

## 13. Metrics

**North star: reach** — newsletter subscribers + X followers. (Attention also compounds into both authors' L1 protocols.)

**Secondary:** revenue — affiliate link payouts, then sponsorships.

**Health:** time on site, churn, email open/CTR, ref-link CTR/conversion.

**Implicit long-run metric:** the track record. Trades determine the value of everything else.

---

## 14. Phasing

### V1 (must-have — cut everything else before these)

1. **Trades + journal → published articles.** The journal system, the book (% of capital spreadsheet), and the article publishing flow with tracker IDs. If scope must be cut to one thing: **generate trades and publish them.**
2. **X account automation** (transcripts + Bamsec + central bank scraper → materiality gate → auto-post).
3. Beehiiv distribution + X Articles republication (low-lift, rides on #1).

### Phase 2

- Signal-block interface into the editorial pipeline
- Ref-link registry (systematized; manual links acceptable in v1)
- Agentic research packet automation (manual-assisted in v1)
- YouTube show + clipping pipeline
- Alt-data analytics instrumentation (retail interest, tweet engagement)

### Phase 3+

- Per-stock financial models on asset pages
- Sell-side consensus layer (pending data-source decision)
- Terminal API productization (paid agent access)
- YouTube/podcast transcript ingestion; X API founder-account monitoring
- Fully autonomous AI PM (separate book, separate spec)

---

## 15. Open Questions

1. **Sell-side consensus data source** — which vendor, at what cost/licensing terms.
2. **X auto-post confidence threshold** — accept the recommended interim human-review routing for low-confidence extractions, or ship fully autonomous from day one?
3. **X Articles lag** — how long between site publication and X Article republication?
4. **Tracker depth** — v1 tracker is open/closed status; do we add entry price / return-since-publication in a later phase (relevant to track-record credibility)?
5. **Journal tooling** — which encrypted collaborative document system (must support both authors + eventual structured extraction into signal input).
