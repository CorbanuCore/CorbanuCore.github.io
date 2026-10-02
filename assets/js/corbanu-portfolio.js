/* Public tracker arithmetic. Quantities and cash flows use the ledger's capital unit. */
(function (root) {
  'use strict';
  const epsilon = 1e-12;
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const time = value => {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw Error('A dated UTC observation is required.');
    const result = Date.parse(value);
    if (!Number.isFinite(result)) throw Error('Invalid observation date.');
    return result;
  };
  function validateLedger(ledger) {
    if (ledger.schema !== 'corbanu.portfolio.v1') throw Error('Unsupported portfolio ledger.');
    if (ledger.state === 'pending') return ledger;
    if (ledger.state !== 'ready' || !number(ledger.initialCapital) || ledger.initialCapital <= 0) throw Error('Confirmed starting capital is required.');
    const start = time(ledger.inception), ids = new Set(), events = new Set();
    if (!Array.isArray(ledger.positions) || !Array.isArray(ledger.events)) throw Error('Position and transaction history is required.');
    for (const position of ledger.positions) {
      if (!position.id || ids.has(position.id) || !position.symbol || !position.name) throw Error('Invalid or duplicate position.');
      if (position.markAdapter === 'hyperliquid' && (typeof position.rawSymbol !== 'string' || !position.rawSymbol)) throw Error('Native marks need a venue instrument identifier.');
      if (position.markAdapter === 'felix' && (!position.rawSymbol || !position.underlyingTicker)) throw Error('Spot marks need token and underlying identifiers.');
      ids.add(position.id);
    }
    let previous = start;
    for (const event of ledger.events) {
      const stamp = time(event.at);
      if (!event.id || events.has(event.id) || !ids.has(event.positionId) || stamp < previous) throw Error('Invalid transaction identity or date order.');
      events.add(event.id);
      previous = stamp;
      if (event.type === 'trade') {
        if (!number(event.quantity) || Math.abs(event.quantity) < epsilon || !number(event.price) || event.price <= 0) throw Error('Trade quantity and price are required.');
        if (event.fee != null && (!number(event.fee) || event.fee < 0)) throw Error('Invalid transaction fee.');
      } else if (event.type === 'cashflow') {
        if (!number(event.amount)) throw Error('Invalid portfolio cash flow.');
      } else throw Error('Unsupported portfolio event.');
    }
    return ledger;
  }
  function applyEvent(book, event) {
    const row = book[event.positionId];
    if (event.type === 'cashflow') { row.cashPnl += event.amount; return; }
    const old = row.quantity, delta = event.quantity, next = old + delta;
    if (Math.abs(old) < epsilon || Math.sign(old) === Math.sign(delta)) {
      row.averageEntry = (Math.abs(old) * row.averageEntry + Math.abs(delta) * event.price) / Math.abs(next);
      row.status = Math.abs(old) < epsilon ? 'Opened' : 'Added';
    } else {
      const closed = Math.min(Math.abs(old), Math.abs(delta));
      row.realizedPnl += closed * Math.sign(old) * (event.price - row.averageEntry);
      row.status = Math.abs(next) < epsilon ? 'Exited' : Math.sign(next) !== Math.sign(old) ? 'Reversed' : 'Cut';
      if (Math.abs(next) < epsilon) row.averageEntry = 0;
      else if (Math.sign(next) !== Math.sign(old)) row.averageEntry = event.price;
    }
    row.quantity = Math.abs(next) < epsilon ? 0 : next;
    row.cashPnl -= event.fee || 0;
    row.changedAt = event.at;
    row.lastEvent = event;
    row.activity.push({...event, status: row.status, previousQuantity: old, quantityAfter: row.quantity});
  }
  function valueBook(ledger, at, marks) {
    validateLedger(ledger);
    if (ledger.state !== 'ready') return null;
    const stamp = time(at), book = {};
    if (stamp < time(ledger.inception)) throw Error('Valuation precedes inception.');
    for (const position of ledger.positions) book[position.id] = {...position, quantity: 0, averageEntry: 0, realizedPnl: 0, cashPnl: 0, status: 'Pending', activity: []};
    for (const event of ledger.events) {
      if (time(event.at) > stamp) break;
      applyEvent(book, event);
    }
    let total = 0, realized = 0, unrealized = 0, cash = 0, gross = 0, net = 0;
    const missing = [];
    for (const row of Object.values(book)) {
      const mark = marks[row.id];
      const valid = mark && number(mark.price) && mark.price > 0 && time(mark.observedAt) <= stamp && (!row.changedAt || time(mark.observedAt) >= time(row.changedAt));
      row.mark = valid ? mark.price : null;
      row.markAsOf = valid ? mark.observedAt : null;
      row.markSource = valid ? mark.source : null;
      row.unrealizedPnl = row.quantity ? valid ? row.quantity * (mark.price - row.averageEntry) : null : 0;
      row.pnl = row.unrealizedPnl == null ? null : row.realizedPnl + row.unrealizedPnl + row.cashPnl;
      row.pnlPct = row.pnl == null ? null : row.pnl / ledger.initialCapital * 100;
      row.weightPct = row.quantity ? valid ? row.quantity * mark.price / ledger.initialCapital * 100 : null : 0;
      row.entryWeightPct = row.quantity * row.averageEntry / ledger.initialCapital * 100;
      if (row.pnl == null) missing.push(row.symbol);
      else { total += row.pnl; unrealized += row.unrealizedPnl; }
      realized += row.realizedPnl;
      cash += row.cashPnl;
      if (row.weightPct != null) { gross += Math.abs(row.weightPct); net += row.weightPct; }
    }
    return {at, positions: Object.values(book), complete: missing.length === 0, missing,
      pnlPct: missing.length ? null : total / ledger.initialCapital * 100,
      realizedPct: realized / ledger.initialCapital * 100,
      unrealizedPct: missing.length ? null : unrealized / ledger.initialCapital * 100,
      cashPct: cash / ledger.initialCapital * 100,
      grossPct: missing.length ? null : gross, netPct: missing.length ? null : net};
  }
  function history(ledger, observations) {
    let previous = -Infinity;
    return observations.map(observation => {
      const stamp = time(observation.at);
      if (stamp <= previous) throw Error('Market observations must have unique increasing dates.');
      previous = stamp;
      return valueBook(ledger, observation.at, observation.marks);
    });
  }
  const api = {validateLedger, valueBook, history};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CorbanuPortfolio = api;
})(typeof window === 'undefined' ? globalThis : window);
