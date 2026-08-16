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
source = source.replace(marker, "  window.__startLivePerpPrice = startLivePerpPrice;\n\n" + marker);
vm.runInNewContext(source, context, { filename: "market-lens.js" });

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
