import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const {valueBook, history, validateLedger} = createRequire(import.meta.url)('../assets/js/corbanu-portfolio.js');
const at = day => `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`;
const event = (day, quantity, price, more = {}) => ({id: `fill-${day}`, at: at(day), type: 'trade', positionId: 'stock', quantity, price, ...more});
const book = events => ({schema: 'corbanu.portfolio.v1', state: 'ready', initialCapital: 1000, inception: at(1), positions: [{id: 'stock', symbol: 'TEST', name: 'Fixture company'}], events});
const marks = (day, price) => ({stock: {price, observedAt: at(day), source: 'synthetic test mark'}});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('long cuts and exits retain realized gains against original capital', () => {
  const ledger = book([event(1, 10, 100), event(3, -4, 120), event(5, -6, 130)]);
  const cut = valueBook(ledger, at(4), marks(4, 110));
  close(cut.realizedPct, 8); close(cut.unrealizedPct, 6); close(cut.pnlPct, 14);
  assert.equal(cut.positions[0].quantity, 6); assert.equal(cut.positions[0].status, 'Cut');
  const exited = valueBook(ledger, at(6), {});
  close(exited.pnlPct, 26); close(exited.grossPct, 0);
  assert.equal(exited.complete, true); assert.equal(exited.positions[0].status, 'Exited');
});
test('short additions use average cost; partial covering realizes correct sign', () => {
  const ledger = book([event(1, -10, 100), event(2, -5, 80), event(3, 6, 90), event(5, 9, 85)]);
  const added = valueBook(ledger, at(2), marks(2, 80));
  close(added.pnlPct, 20); close(added.positions[0].averageEntry, 1400 / 15); assert.equal(added.positions[0].status, 'Added');
  const cut = valueBook(ledger, at(4), marks(4, 85));
  close(cut.realizedPct, 2); close(cut.unrealizedPct, 7.5); close(cut.pnlPct, 9.5);
  close(cut.netPct, -76.5); close(cut.grossPct, 76.5);
  const exited = valueBook(ledger, at(5), {}); close(exited.pnlPct, 9.5); assert.equal(exited.positions[0].quantity, 0);
});
test('reversing direction closes old units and prices the new side separately', () => {
  const ledger = book([event(1, 10, 100), event(2, -15, 120)]);
  const result = valueBook(ledger, at(3), marks(3, 110));
  close(result.realizedPct, 20); close(result.unrealizedPct, 5); close(result.pnlPct, 25);
  assert.equal(result.positions[0].status, 'Reversed'); assert.equal(result.positions[0].averageEntry, 120);
});
test('recorded cash flows and fees contribute separately to price P&L', () => {
  const ledger = book([event(1, -10, 100, {fee: 2}), {id: 'funding-2', at: at(2), type: 'cashflow', positionId: 'stock', amount: 5}]);
  const result = valueBook(ledger, at(3), marks(3, 110));
  close(result.pnlPct, -9.7); close(result.unrealizedPct, -10); close(result.cashPct, .3);
});
test('missing active marks make total unknown while realized results survive', () => {
  const result = valueBook(book([event(1, 10, 100), event(2, -4, 120)]), at(3), {});
  assert.equal(result.complete, false); assert.equal(result.pnlPct, null); assert.equal(result.grossPct, null);
  close(result.realizedPct, 8); assert.deepEqual(result.missing, ['TEST']);
});
test('future marks and future transactions are never used in earlier observations', () => {
  const ledger = book([event(1, 10, 100), event(4, -10, 150)]);
  assert.equal(valueBook(ledger, at(3), marks(4, 150)).pnlPct, null);
  const earlier = valueBook(ledger, at(2), marks(2, 110)); close(earlier.pnlPct, 10);
  assert.equal(earlier.positions[0].quantity, 10);
  const added = book([event(1, 10, 100), event(3, 5, 105)]);
  assert.equal(valueBook(added, at(4), marks(2, 110)).pnlPct, null, 'A mark from before the addition cannot value the changed position.');
});
test('history preserves incomplete gaps and validates timestamp order', () => {
  const ledger = book([event(1, 10, 100)]);
  const result = history(ledger, [{at: at(1), marks: marks(1, 100)}, {at: at(2), marks: {}}, {at: at(3), marks: marks(3, 120)}]);
  assert.deepEqual(result.map(point => point.pnlPct), [0, null, 20]);
  assert.throws(() => history(ledger, [{at: at(2), marks: {}}, {at: at(1), marks: {}}]), /increasing/);
});
test('rejects fabricated defaults for missing capital, prices, dates and duplicate fills', () => {
  assert.throws(() => validateLedger({...book([]), initialCapital: null}), /capital/);
  assert.throws(() => validateLedger(book([event(1, 10, 0)])), /price/);
  assert.throws(() => validateLedger(book([event(1, 10, 100, {at: '2026-09-01'})])), /UTC/);
  assert.throws(() => validateLedger(book([event(1, 10, 100), event(2, 10, 100, {id: 'fill-1'})])), /identity/);
  assert.throws(() => validateLedger(book([event(2, 10, 100), event(1, 10, 100)])), /order/);
  assert.equal(valueBook({schema: 'corbanu.portfolio.v1', state: 'pending'}, at(1), {}), null);
});
