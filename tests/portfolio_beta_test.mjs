import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const {dailyPrices, dailyBook, realizedBeta} = createRequire(import.meta.url)('../assets/js/corbanu-portfolio.js');
const day = 86400000, end = Date.parse('2026-10-02T00:00:00Z') - 1, at = '2026-10-02T12:00:00Z';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const candle = (stamp, price, symbol = 'BENCH') => ({s: symbol, i: '1d', t: stamp - day + 1, T: stamp, c: String(price)});
function regressionFixture(days, slope = 1.5, intercept = .001) {
  const values = [], candles = []; let nav = 1, price = 100;
  for (let i = 0; i <= days; i++) {
    const stamp = end - (days - i) * day, x = ((i % 5) - 2) * .01;
    if (i) { nav *= 1 + slope * x + intercept; price *= 1 + x; }
    values.push({at: new Date(stamp).toISOString(), pnlPct: (nav - 1) * 100, complete: true});
    candles.push(candle(stamp, price));
  }
  return {values, candles};
}
test('daily beta regresses NAV returns with an intercept, including positive, negative and zero beta', () => {
  for (const slope of [1.5, -.75, 0]) {
    const {values, candles} = regressionFixture(30, slope);
    const result = realizedBeta(values, candles, {rawSymbol: 'BENCH', at});
    close(result.beta, slope); assert.equal(result.observations, 30); assert.equal(result.fullWindow, true);
    if (slope) close(result.rSquared, 1);
  }
});
test('90-day regression requires all 90 matching daily return pairs; short history is disclosed', () => {
  const full = regressionFixture(90), short = regressionFixture(27);
  assert.equal(realizedBeta(full.values, full.candles, {rawSymbol:'BENCH', days:90, at}).fullWindow, true);
  const result = realizedBeta(short.values, short.candles, {rawSymbol:'BENCH', days:90, at});
  assert.equal(result.fullWindow, false); assert.equal(result.observations, 27); close(result.beta, 1.5);
  assert.equal(realizedBeta(full.values, full.candles, {rawSymbol:'BENCH', days:30, at}).observations, 30);
});
test('daily gaps and incomplete book valuations are not bridged into one-day returns', () => {
  const data = regressionFixture(30); data.values[12].complete = false;
  const result = realizedBeta(data.values, data.candles, {rawSymbol:'BENCH', at});
  assert.equal(result.observations, 28); close(result.beta, 1.5);
  const missing = regressionFixture(30); missing.candles.splice(12, 1);
  assert.equal(realizedBeta(missing.values, missing.candles, {rawSymbol:'BENCH', at}).observations, 28);
});
test('unfinished days, mismatched instruments, invalid boundaries and variance failures are handled explicitly', () => {
  const data = regressionFixture(30); data.candles.push(candle(end + day, 1000000));
  assert.equal(realizedBeta(data.values, data.candles, {rawSymbol:'BENCH', at}).observations, 30);
  assert.throws(() => dailyPrices(data.candles, 'WRONG', at), /mismatch/);
  assert.throws(() => dailyPrices([{...data.candles[0], T: end}], 'BENCH', at), /boundary/);
  assert.throws(() => dailyPrices([candle(end, 0)], 'BENCH', at), /price/);
  const constant = data.candles.map(row => ({...row, c:'100'}));
  const out = realizedBeta(data.values, constant, {rawSymbol:'BENCH', at});
  assert.equal(out.beta, null); assert.match(out.reason, /variance/);
  assert.equal(realizedBeta(data.values.slice(-2), data.candles, {rawSymbol:'BENCH', at}).beta, null);
});
test('daily book keeps published changes, capital dilution, dated spot quotes and split basis', () => {
  const ledger = {schema:'corbanu.portfolio.v1', state:'ready', initialCapital:1000, inception:'2026-09-28T00:00:00Z', positions:[
    {id:'perp',symbol:'STOCK',name:'Fixture',rawSymbol:'xyz:STOCK',markAdapter:'hyperliquid',historicalPriceAdjustments:[{before:'2026-09-29T08:00:00Z',divisor:3}]},
    {id:'spot',symbol:'TOKEN',name:'Dated fixture',rawSymbol:'TOKEN',underlyingTicker:'STOCK',markAdapter:'felix'}], events:[
    {id:'entry',positionId:'perp',type:'trade',at:'2026-09-28T00:00:00Z',quantity:3,price:100,targetWeightPct:30},
    {id:'spot-entry',positionId:'spot',type:'trade',at:'2026-09-28T00:00:00Z',quantity:1,price:100,targetWeightPct:10},
    {id:'cut',positionId:'perp',type:'trade',at:'2026-09-30T12:00:00Z',quantity:-1,price:120,targetWeightPct:20}]};
  const stamps = [3,2,1,0].map(offset=>end-offset*day);
  const prices = [330,120,125,130].map((price,i)=>candle(stamps[i],price,'xyz:STOCK'));
  const recorded = [{at:'2026-09-28T00:00:00Z',marks:{spot:{price:100,observedAt:'2026-09-28T00:00:00Z'}}},
    {at:'2026-10-02T01:00:00Z',marks:{spot:{price:1000,observedAt:'2026-10-02T01:00:00Z'}}}];
  const values = dailyBook(ledger,recorded,{'xyz:STOCK':prices},at);
  close(values[0].pnlPct,3);close(values[1].pnlPct,6);close(values[2].pnlPct,7);close(values[3].pnlPct,8);
  assert.equal(values[2].positions[0].status,'Cut');assert.equal(values[2].positions[0].quantity,2);
  assert.equal(values[1].positions[0].mark,120,'A split within the UTC day must not divide the post-split close again.');
  assert.equal(values[3].positions[1].mark,100,'Future spot prices never enter historical daily NAV.');
  assert.deepEqual(values[3].retained,[{symbol:'TOKEN',observedAt:'2026-09-28T00:00:00Z'}]);
  const gap = dailyBook(ledger,recorded,{'xyz:STOCK':prices.filter((_,i)=>i!==2)},at);
  assert.equal(gap[2].complete,false,'A dated intraday quote must not substitute for a missing perp daily close.');
});
