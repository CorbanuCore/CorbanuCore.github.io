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
  "  window.__startLivePerpPrice = startLivePerpPrice;\n  window.__candleWidthForRows = candleWidthForRows;\n  window.__computeLivePeerRow = computeLivePeerRow;\n\n" + marker,
);
vm.runInNewContext(source, context, { filename: "market-lens.js" });

const sparseRows = Array.from({ length: 10 }, (_, index) => ({ d: `2026-08-${String(index + 7).padStart(2, "0")}` }));
const sparseX = Object.fromEntries(sparseRows.map((row, index) => [row.d, index * 4.779342723]));
const sparseWidth = context.window.__candleWidthForRows(sparseRows, (date) => sparseX[date], 1018);
assert.ok(sparseWidth < 4.779342723, "sparse perp candle bodies must not overlap adjacent dates");
assert.ok(Math.abs(sparseWidth - 3.919061033) < 1e-6);

const establishedRows = Array.from({ length: 182 }, (_, index) => ({ d: String(index) }));
const establishedWidth = context.window.__candleWidthForRows(establishedRows, (date) => Number(date) * 4.757, 1018);
assert.ok(establishedWidth < 4.757, "established-history candles must retain a visible gap");
assert.ok(establishedWidth > 3.8, "established-history candles should retain their existing visual weight");

const livePeerData = {
  peerMapping: {
    liveSplice: {
      baseLevel: 100,
      inputs: [
        { raw_symbol: "xyz:MSFT", weight: .5, spot_close_usd: 100 },
        { raw_symbol: "xyz:GOOGL", weight: .3, spot_close_usd: 100 },
        { raw_symbol: "xyz:AMZN", weight: .2, spot_close_usd: 100 },
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
