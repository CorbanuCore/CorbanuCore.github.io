import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('(function significantMovesBoard()');
const end = page.indexOf('(async function renderLatestPosts()', start);
assert.ok(start > 0 && end > start);
const source = page.slice(start, end).trim();
const elements = {
  'moves-grid': {innerHTML: ''}, 'moves-asof': {textContent: ''},
  'moves-live-dot': {classList: {add() {}, remove() {}}},
};
const requests = [];
let refresh;
let incomplete = false;
let rejected = false;
const entries = [
  {symbol: 'LIT', name: 'Lithium', slug: 'lit', rawSymbol: 'xyz:LIT', reference24hPrice: 500, change24hPct: -50, peerAvg24hPct: 0, divergence24hPct: -50, peers: [{rawSymbol: 'BTC', weight: 1, reference24hPrice: 500}]},
  {symbol: 'BTC', name: 'Bitcoin', slug: 'btc', rawSymbol: 'BTC', reference24hPrice: 500, change24hPct: 0, peerAvg24hPct: 0, divergence24hPct: 0, peers: [{rawSymbol: 'xyz:LIT', weight: 1, reference24hPrice: 500}]},
];
const context = {
  document: {hidden: false, getElementById: id => elements[id], addEventListener() {}},
  navigator: {onLine: true}, setInterval: callback => {refresh = callback;},
  fetch: async (url, options) => {
    if (!options) return {ok: true, json: async () => ({entries, generatedAt: '2026-10-01T20:00:00Z'})};
    const body = JSON.parse(options.body);
    requests.push(body);
    if (rejected) throw new Error('Connection lost');
    return {ok: true, json: async () => body.dex === 'xyz'
      ? [{universe: [{name: 'xyz:LIT'}]}, incomplete ? [] : [{midPx: '100.74', prevDayPx: '100'}]]
      : [{universe: [{name: 'BTC'}]}, [{midPx: '110', prevDayPx: '100'}]]};
  },
};
vm.runInNewContext(source, context);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(requests.sort((a,b) => String(a.dex || '').localeCompare(String(b.dex || ''))), [
  {type: 'metaAndAssetCtxs'}, {type: 'metaAndAssetCtxs', dex: 'xyz'},
]);
assert.match(elements['moves-grid'].innerHTML, /\+0\.74%/);
assert.match(elements['moves-grid'].innerHTML, /\+10\.00%/);
assert.match(elements['moves-grid'].innerHTML, /−9\.26%|-9\.26%/);
assert.doesNotMatch(elements['moves-grid'].innerHTML, /-50\.00%/);
const lastComplete = elements['moves-grid'].innerHTML;
incomplete = true;
await refresh();
assert.equal(elements['moves-grid'].innerHTML, lastComplete);
assert.match(elements['moves-asof'].textContent, /last successful refresh/);
incomplete = false;
rejected = true;
await refresh();
assert.equal(elements['moves-grid'].innerHTML, lastComplete);
assert.match(elements['moves-asof'].textContent, /Live refresh unavailable/);
console.log('Homepage native returns and complete-snapshot retention verified.');
