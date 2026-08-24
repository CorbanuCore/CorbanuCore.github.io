import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const elements = Object.fromEntries([
  "live-perp-module",
  "live-perp-state",
  "live-perp-price",
  "live-perp-change",
  "live-perp-time",
  "live-perp-announcer",
].map((id) => [id, { id, className: "", textContent: "", value: "", dateTime: "" }]));

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
}

let nextTimer = 1;
const windowEvents = {};
const context = {
  console,
  Date,
  Intl,
  JSON,
  Math,
  Number,
  String,
  URL,
  WebSocket: FakeWebSocket,
  navigator: { onLine: true },
  fetch: async () => { throw new Error("REST fallback was not expected"); },
  setTimeout: () => nextTimer++,
  clearTimeout: () => {},
  setInterval: () => nextTimer++,
  clearInterval: () => {},
  document: {
    readyState: "loading",
    body: { dataset: {} },
    getElementById: (id) => elements[id] || null,
    addEventListener: () => {},
  },
  window: {
    WebSocket: FakeWebSocket,
    addEventListener: (name, listener) => { windowEvents[name] = listener; },
  },
};
context.globalThis = context;

let source = fs.readFileSync(new URL("../assets/js/market-lens.js", import.meta.url), "utf8");
const marker = "  if (document.readyState === \"loading\")";
assert.ok(source.includes(marker), "market client initialization marker changed");
source = source.replace(
  marker,
  "  window.__startLivePerpPrice = startLivePerpPrice;\n  window.__upsertLivePerpCandle = upsertLivePerpCandle;\n  window.__candleWidthForRows = candleWidthForRows;\n  window.__priceDomainForValues = priceDomainForValues;\n  window.__structureImpliedVolPct = structureImpliedVolPct;\n  window.__computeLivePeerRow = computeLivePeerRow;\n  window.__renderPeerPerformance = renderPeerPerformance;\n  window.__renderWeightedPeerAverages = renderWeightedPeerAverages;\n  window.__fetchLivePeerMids = fetchLivePeerMids;\n  window.__rebasePeerSeriesToSpot = rebasePeerSeriesToSpot;\n\n" + marker,
);
vm.runInNewContext(source, context, { filename: "market-lens.js" });

const xrpDomain = context.window.__priceDomainForValues([.992346, 1.7422357]);
assert.ok(xrpDomain.low > .9, "sub-dollar and low-dollar charts must not be forced to a zero baseline");
assert.ok(xrpDomain.high < 1.82, "XRP-scale charts should retain local price resolution");
const solDomain = context.window.__priceDomainForValues([70, 82]);
assert.ok(solDomain.low > 68 && solDomain.high < 84, "larger-dollar charts should keep proportional padding");

assert.equal(
  context.window.__structureImpliedVolPct({ put: { impliedVolPct: 75.851 }, call: { impliedVolPct: 75.851 } }),
  75.851,
  "ATM straddle IV should average its call and put IVs",
);
assert.equal(
  context.window.__structureImpliedVolPct({ call: { impliedVolPct: 79.383 } }),
  79.383,
  "single-leg rows should display that contract IV",
);

const sparseRows = Array.from({ length: 10 }, (_, index) => ({ d: `2026-08-${String(index + 7).padStart(2, "0")}` }));
const sparseX = Object.fromEntries(sparseRows.map((row, index) => [row.d, index * 4.779342723]));
const sparseWidth = context.window.__candleWidthForRows(sparseRows, (date) => sparseX[date], 1018);
assert.ok(sparseWidth < 4.779342723, "sparse perp candle bodies must not overlap adjacent dates");
assert.ok(Math.abs(sparseWidth - 3.919061033) < 1e-6);

const establishedRows = Array.from({ length: 182 }, (_, index) => ({ d: String(index) }));
const establishedWidth = context.window.__candleWidthForRows(establishedRows, (date) => Number(date) * 4.757, 1018);
assert.ok(establishedWidth < 4.757, "established-history candles must retain a visible gap");
assert.ok(establishedWidth > 3.8, "established-history candles should retain their existing visual weight");

const staleCandleData = {
  endDate: "2026-08-22",
  perp: [{
    d: "2026-08-22", o: 100, h: 105, l: 98, c: 100, r: 2,
    f: .0002, p: "exact", s: "complete", t: "2026-08-22T20:00:00Z",
  }],
};
assert.equal(
  context.window.__upsertLivePerpCandle(
    staleCandleData, 90, new Date("2026-08-24T14:30:00Z"),
  ),
  true,
);
assert.equal(staleCandleData.endDate, "2026-08-24");
assert.equal(staleCandleData.perp.length, 2);
assert.deepEqual(
  {
    d: staleCandleData.perp[1].d,
    o: staleCandleData.perp[1].o,
    h: staleCandleData.perp[1].h,
    l: staleCandleData.perp[1].l,
    c: staleCandleData.perp[1].c,
    r: staleCandleData.perp[1].r,
    p: staleCandleData.perp[1].p,
    live: staleCandleData.perp[1].live,
  },
  { d: "2026-08-24", o: 90, h: 90, l: 90, c: 90, r: 1.8, p: "partial", live: true },
  "a stale static series must append today's live perp mid as an outlined partial candle",
);
context.window.__upsertLivePerpCandle(
  staleCandleData, 94, new Date("2026-08-24T14:31:00Z"),
);
assert.equal(staleCandleData.perp[1].o, 90);
assert.equal(staleCandleData.perp[1].h, 94);
assert.equal(staleCandleData.perp[1].l, 90);
assert.equal(staleCandleData.perp[1].c, 94);
assert.equal(staleCandleData.perp[1].r, 1.88);
assert.equal(staleCandleData.perp[1].f, 0);
assert.match(staleCandleData.perp[1].t, /^2026-08-24T14:31:00/);

const allMidsRequests = [];
context.fetch = async (_url, options) => {
  const payload = JSON.parse(options.body);
  allMidsRequests.push(payload);
  return {
    ok: true,
    json: async () => payload.dex === "xyz"
      ? { "xyz:MSFT": "110" }
      : { BTC: "65000", ETH: "2000" },
  };
};
const mixedMids = await context.window.__fetchLivePeerMids({ dexes: ["", "xyz"] });
assert.deepEqual(allMidsRequests, [{ type: "allMids" }, { type: "allMids", dex: "xyz" }]);
assert.equal(mixedMids.BTC, "65000");
assert.equal(mixedMids["xyz:MSFT"], "110");
const change24h = { dataset: { referencePrice: "100" }, textContent: "", className: "" };
const change7d = { dataset: { referencePrice: "120" }, textContent: "", className: "" };
const performanceRow = {
  dataset: { peerRawSymbol: "xyz:MSFT" },
  querySelectorAll: () => [change24h, change7d],
};
context.document.querySelectorAll = (selector) => selector === "[data-peer-raw-symbol]" ? [performanceRow] : [];
context.window.__renderPeerPerformance({ "xyz:MSFT": "110" });
assert.equal(change24h.textContent, "+10.00%");
assert.equal(change24h.className, "peer-change positive");
assert.equal(change7d.textContent, "-8.33%");
assert.equal(change7d.className, "peer-change negative");

const peerCells = (change24hPct, change7dPct) => ({
  "24h": { dataset: { peerChangeValue: String(change24hPct) } },
  "7d": { dataset: { peerChangeValue: String(change7dPct) } },
});
const peerAChanges = peerCells(10, -2);
const peerBChanges = peerCells(-5, 3);
const weightedPeerRows = [
  { dataset: { peerWeight: "0.75" }, querySelector: (selector) => peerAChanges[selector.includes("24h") ? "24h" : "7d"] },
  { dataset: { peerWeight: "0.25" }, querySelector: (selector) => peerBChanges[selector.includes("24h") ? "24h" : "7d"] },
];
const averageCells = {
  "24h": { dataset: {}, textContent: "", className: "" },
  "7d": { dataset: {}, textContent: "", className: "" },
};
const peerTable = { querySelectorAll: () => weightedPeerRows };
const averageRow = {
  closest: () => peerTable,
  querySelector: (selector) => averageCells[selector.includes("24h") ? "24h" : "7d"],
};
context.document.querySelectorAll = (selector) => selector === "[data-peer-average-row]" ? [averageRow] : [];
context.window.__renderWeightedPeerAverages();
assert.equal(averageCells["24h"].textContent, "+6.25%");
assert.equal(averageCells["24h"].className, "peer-change positive");
assert.equal(averageCells["7d"].textContent, "-0.75%");
assert.equal(averageCells["7d"].className, "peer-change negative");
context.fetch = async () => { throw new Error("REST fallback was not expected"); };

const livePeerData = {
  peerMapping: {
    liveSplice: {
      baseLevel: 100,
      inputs: [
        { raw_symbol: "xyz:MSFT", weight: .5, spot_close_usd: 50, perp_reference_price: 100 },
        { raw_symbol: "xyz:GOOGL", weight: .3, spot_close_usd: 200, perp_reference_price: 100 },
        { raw_symbol: "xyz:AMZN", weight: .2, spot_close_usd: 25, perp_reference_price: 100 },
      ],
    },
  },
};
const livePeerRow = context.window.__computeLivePeerRow(
  livePeerData,
  { "xyz:MSFT": 110, "xyz:GOOGL": 100, "xyz:AMZN": 90 },
  new Date("2026-08-17T01:02:03Z"),
);
assert.equal(livePeerRow.d, "2026-08-17");
assert.ok(Math.abs(livePeerRow.c - 103) < 1e-9);
assert.equal(livePeerRow.n, 3);
assert.equal(livePeerRow.live, true);
assert.equal(
  context.window.__computeLivePeerRow(livePeerData, { "xyz:MSFT": 110, "xyz:GOOGL": 100 }, new Date()),
  null,
  "the live splice must require at least three current perp mids",
);

const rebasedPeers = context.window.__rebasePeerSeriesToSpot(
  [{ d: "2026-02-17", c: 12 }, { d: "2026-08-14", c: 30, live: true }],
  [{ d: "2026-02-17", c: 180 }, { d: "2026-08-14", c: 225 }],
);
assert.deepEqual(
  rebasedPeers.map((row) => row.c),
  [180, 450],
  "the peer basket must share the target level at the selected range anchor",
);
assert.equal(rebasedPeers[1].viewAnchor, "2026-02-17");

context.window.__startLivePerpPrice({ rawSymbol: "xyz:TSLA" });
assert.equal(FakeWebSocket.instances.length, 1);
const socket = FakeWebSocket.instances[0];
assert.equal(socket.url, "wss://api.hyperliquid.xyz/ws");
socket.onopen();
assert.deepEqual(socket.sent[0], {
  method: "subscribe",
  subscription: { type: "activeAssetCtx", coin: "xyz:TSLA" },
});

socket.onmessage({
  data: JSON.stringify({
    channel: "activeAssetCtx",
    data: {
      coin: "xyz:TSLA",
      ctx: { midPx: "342.815", markPx: "342.95", prevDayPx: "342.02" },
    },
  }),
});

assert.equal(elements["live-perp-price"].textContent, "$342.82");
assert.equal(elements["live-perp-price"].value, "342.815");
assert.equal(elements["live-perp-change"].textContent, "+0.23%");
assert.match(elements["live-perp-change"].className, /positive/);
assert.equal(elements["live-perp-state"].textContent, "Live");
assert.equal(elements["live-perp-module"].className, "live-perp is-live");
assert.match(elements["live-perp-time"].textContent, / UTC$/);
assert.equal(elements["live-perp-announcer"].textContent, "Hyperliquid perpetual price feed live.");
assert.ok(windowEvents.pagehide, "page lifecycle cleanup was not registered");

console.log("live perp client subscription and render test passed");
