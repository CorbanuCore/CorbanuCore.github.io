import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const ledger = JSON.parse(read('assets/portfolio/ledger.json'));
const marks = JSON.parse(read('assets/portfolio/marks.json'));
const sources = JSON.parse(read('assets/portfolio/reference-quotes.json'));
const statistics = JSON.parse(read('assets/portfolio/statistics.json'));
const {valueBook, aggregateStatistics} = createRequire(import.meta.url)('../assets/js/corbanu-portfolio.js');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('published pair uses stated weights and native quotes on a matching price basis', () => {
  assert.equal(sources.references.length, 2);
  for (const source of sources.references) {
    const event = ledger.events.find(row => row.id === source.eventId);
    const position = ledger.positions.find(row => row.id === event.positionId);
    assert.equal(position.rawSymbol, source.rawSymbol);
    assert.equal(source.nativeCandle.s, source.rawSymbol);
    assert.equal(source.nativeCandle.t, Date.parse(event.at));
    close(source.rawPrice, Number(source.nativeCandle.o));
    close(event.price, source.rawPrice / source.divisor);
    close(event.quantity * event.price / ledger.initialCapital * 100, event.targetWeightPct);
    const article = read(source.sourceArticleHref.slice(1));
    assert.equal(createHash('sha256').update(article).digest('hex'), event.sourceSha256);
    assert.match(article.toString(), /3\.0% long Kioxia \/ 8\.5% short JP225/);
  }
});

test('split-adjusted history preserves economic P&L across native quote relisting', () => {
  for (const action of sources.adjustments) {
    const before = action.nativeSamples.filter(row => row.t < Date.parse(action.before)).at(-1);
    const after = action.nativeSamples.find(row => row.t >= Date.parse(action.before));
    const beforeAt = new Date(before.T).toISOString();
    const afterAt = new Date(after.T).toISOString();
    const beforePoint = marks.observations.find(row => Date.parse(row.at) === before.T);
    const afterPoint = marks.observations.find(row => Date.parse(row.at) === after.T);
    close(beforePoint.marks[action.positionId].price, Number(before.c) / action.divisor);
    close(afterPoint.marks[action.positionId].price, Number(after.c));
    const old = valueBook(ledger, beforeAt, beforePoint.marks).positions.find(row => row.id === action.positionId);
    const next = valueBook(ledger, afterAt, afterPoint.marks).positions.find(row => row.id === action.positionId);
    close(next.quantity, old.quantity);
    close(next.pnlPct - old.pnlPct, old.quantity * (Number(after.c) - Number(before.c) / action.divisor) / ledger.initialCapital * 100);
    assert.equal(next.status, 'Opened');
    assert.ok(Math.abs(next.pnlPct - old.pnlPct) < 0.1, 'Quote rebasing must not create a split-sized model loss.');
  }
});

test('both added legs enter marked P&L and weighted statistics while missing metrics stay missing', () => {
  const point = marks.observations.at(-1);
  const current = valueBook(ledger, point.at, point.marks);
  assert.equal(current.complete, true);
  const addedIds = new Set(sources.references.map(source => ledger.events.find(row => row.id === source.eventId).positionId));
  const original = {...ledger, positions: ledger.positions.filter(row => !addedIds.has(row.id)), events: ledger.events.filter(row => !addedIds.has(row.positionId))};
  const baseline = valueBook(original, point.at, point.marks);
  const legs = current.positions.filter(row => addedIds.has(row.id));
  close(current.pnlPct - baseline.pnlPct, legs.reduce((sum, row) => sum + row.pnlPct, 0));
  assert.equal(legs.length, 2);
  assert.ok(legs.every(row => row.quantity && row.mark > 0));
  const groups = aggregateStatistics(current.positions, statistics, point.at);
  assert.equal(groups.long.positionCount, 4);
  assert.equal(groups.short.positionCount, 3);
  close(groups.long.totalWeight, 10.35);
  close(groups.short.totalWeight, 16.125);
  for (const leg of legs) {
    const source = statistics.positions[leg.id];
    assert.equal(source.rawSymbol, leg.rawSymbol);
    assert.equal(source.metrics.forwardPE.observedAt, '2026-09-15');
    assert.equal(source.metrics.sevenDayFundingAprPct.value, null);
    assert.equal(source.metrics.forwardEPSGrowthPct.value, null);
    const side = leg.quantity > 0 ? 'long' : 'short';
    assert.ok(groups[side].metrics.sevenDayFundingAprPct.missing.some(row => row.symbol === leg.symbol));
  }
});
