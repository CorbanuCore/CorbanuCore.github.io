(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const pct = value => value == null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
  const price = value => value == null ? '—' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value < 10 ? 4 : 2}).format(value);
  const date = value => new Date(value).toLocaleString('en-GB', {timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}) + ' UTC';
  const shortDate = value => new Date(value).toLocaleDateString('en-GB', {timeZone: 'UTC', day: '2-digit', month: 'short'});
  const safeLink = href => typeof href === 'string' && /^\/(?!\/)[a-z0-9/_-]*$/i.test(href) ? href : null;
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text != null) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  let ledger, observations = [], historicalValues = [], current, liveObservation, chartPoints = [], chartIndex = 0, period = 'all', filter = 'current', refreshing = false;
  function notice(message) { $('portfolio-notice').textContent = message || ''; $('portfolio-notice').hidden = !message; }
  function feed(message, live) { $('portfolio-feed-text').textContent = message; $('portfolio-feed').classList.toggle('is-live', !!live); }
  function empty(id, heading, message) {
    const element = $(id);
    element.hidden = false;
    element.querySelector('h3').textContent = heading;
    element.querySelector('p').textContent = message;
  }
  function statusCell(row) {
    const cell = node('td');
    cell.append(node('span', row.status, `portfolio-status portfolio-status-${row.status.toLowerCase()}`));
    if (row.changedAt) cell.append(node('small', shortDate(row.changedAt)));
    return cell;
  }
  function positions() {
    const all = current ? current.positions.filter(row => row.activity.length) : [];
    const selected = all.filter(row => filter === 'all' || (filter === 'current' ? row.quantity !== 0 : row.quantity === 0));
    const body = $('portfolio-positions'); body.replaceChildren();
    $('portfolio-position-count').textContent = `${all.filter(row => row.quantity).length} open`;
    $('portfolio-positions-empty').hidden = selected.length > 0;
    if (!selected.length) empty('portfolio-positions-empty', filter === 'exited' ? 'No exited positions' : 'No positions to show', 'Confirmed changes will appear in the activity log below.');
    for (const row of selected) {
      const tr = node('tr'), identity = node('td'), href = safeLink(row.href);
      const side = row.quantity ? row.quantity > 0 ? 'Long' : 'Short' : 'Closed';
      const label = href ? node('a') : node('span');
      if (href) label.href = href;
      label.append(node('strong', row.symbol)); identity.append(label, node('small', side, 'portfolio-mobile-side'), node('small', `${row.name} · ${row.venue || 'tracker'}`)); tr.append(identity);
      tr.append(node('td', side));
      const size = node('td', row.weightPct == null ? '—' : `${Math.abs(row.weightPct).toFixed(2)}%`);
      size.append(node('small', row.quantity ? `${Math.abs(row.entryWeightPct).toFixed(2)}% at cost` : 'position fully exited')); tr.append(size);
      tr.append(node('td', row.quantity ? price(row.averageEntry) : '—'));
      const mark = node('td', row.quantity ? price(row.mark) : '—');
      if (row.quantity && row.markAsOf) { const stamp = node('small', shortDate(row.markAsOf)); stamp.title = `${date(row.markAsOf)} · ${row.markSource || 'recorded mark'}`; mark.append(stamp); }
      tr.append(mark);
      const pnl = node('td', pct(row.pnlPct), row.pnlPct == null ? '' : row.pnlPct >= 0 ? 'positive' : 'negative');
      pnl.append(node('small', 'portfolio contribution')); tr.append(pnl, statusCell(row)); body.append(tr);
    }
  }
  function activity() {
    const rows = current ? current.positions.flatMap(row => row.activity.map(event => ({...event, position: row}))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];
    $('portfolio-activity').replaceChildren(); $('portfolio-activity-empty').hidden = rows.length > 0;
    for (const row of rows) {
      const li = node('li'), stamp = node('time', date(row.at)); stamp.dateTime = row.at;
      li.append(stamp, node('span', row.status, `portfolio-status portfolio-status-${row.status.toLowerCase()}`));
      const delta = Math.abs(row.quantity * row.price / ledger.initialCapital * 100).toFixed(2);
      const side = (row.quantityAfter || row.previousQuantity) > 0 ? 'long' : 'short';
      li.append(node('p', `${row.position.symbol} · ${side} · ${delta}% of capital ${row.status === 'Cut' || row.status === 'Exited' ? 'removed' : 'transacted'} at ${price(row.price)}${row.note ? ` · ${row.note}` : ''}`));
      const href = safeLink(row.href || row.position.articleHref);
      if (href) { const link = node('a', 'Research ↗'); link.href = href; li.append(link); }
      $('portfolio-activity').append(li);
    }
  }
  const svgNode = (tag, attrs, text) => {
    const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
    if (text) result.textContent = text;
    return result;
  };
  function inspect(index) {
    if (!chartPoints.length) return;
    chartIndex = Math.max(0, Math.min(chartPoints.length - 1, index));
    const point = chartPoints[chartIndex], chart = $('pnl-chart');
    chart.querySelectorAll('.portfolio-chart-crosshair, .portfolio-chart-hover').forEach(element => element.remove());
    chart.append(svgNode('line', {x1: point.x, x2: point.x, y1: 12, y2: chart.viewBox.baseVal.height - 38, class: 'portfolio-chart-crosshair'}), svgNode('circle', {cx: point.x, cy: point.y, r: 4, class: 'portfolio-chart-point portfolio-chart-hover'}));
    $('portfolio-chart-readout').replaceChildren(node('span', `${date(point.at)} · `), node('strong', `${pct(point.pnlPct)} of capital`));
  }
  function chart() {
    const svg = $('pnl-chart'); svg.replaceChildren(); chartPoints = [];
    if (!ledger || ledger.state !== 'ready') return;
    const series = historicalValues.slice();
    if (liveObservation && (!series.length || Date.parse(liveObservation.at) > Date.parse(series[series.length - 1].at))) series.push(CorbanuPortfolio.valueBook(ledger, liveObservation.at, liveObservation.marks));
    const end = series.length ? Date.parse(series[series.length - 1].at) : Date.now(), start = period === 'all' ? -Infinity : end - Number(period) * 86400000;
    const selected = series.filter(point => Date.parse(point.at) >= start), valid = selected.filter(point => point.complete);
    if (!valid.length) { empty('portfolio-chart-empty', 'No complete valuations yet', 'The P&L line appears once every held position has a dated mark.'); return; }
    $('portfolio-chart-empty').hidden = true;
    const width = Math.max(320, svg.getBoundingClientRect().width), height = window.innerWidth <= 720 ? 240 : 300, left = 60, right = width - 18, floor = height - 38;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const lo = Math.min(0, ...valid.map(point => point.pnlPct)), hi = Math.max(0, ...valid.map(point => point.pnlPct)), pad = Math.max((hi - lo) * .15, .02), bottom = lo - pad, top = hi + pad;
    const first = Date.parse(selected[0].at), last = Date.parse(selected[selected.length - 1].at), span = Math.max(last - first, 3600000);
    const x = value => left + (Date.parse(value) - first) / span * (right - left), y = value => 12 + (top - value) / (top - bottom) * (floor - 12);
    for (let i = 0; i <= 4; i++) {
      const value = bottom + (top - bottom) * i / 4, py = y(value);
      svg.append(svgNode('line', {x1: left, x2: right, y1: py, y2: py, class: 'portfolio-chart-grid'}), svgNode('text', {x: left - 10, y: py + 4, 'text-anchor': 'end', class: 'portfolio-chart-label'}, `${value.toFixed(2)}%`));
    }
    svg.append(svgNode('line', {x1: left, x2: right, y1: y(0), y2: y(0), class: 'portfolio-chart-zero'}));
    let path = '', previousComplete = false;
    for (const point of selected) {
      if (!point.complete) { previousComplete = false; continue; }
      const px = x(point.at), py = y(point.pnlPct);
      path += `${previousComplete ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)} `; previousComplete = true;
      chartPoints.push({...point, x: px, y: py});
    }
    svg.append(svgNode('path', {d: path, class: 'portfolio-chart-line'}));
    const final = chartPoints[chartPoints.length - 1];
    svg.append(svgNode('circle', {cx: final.x, cy: final.y, r: 4, class: 'portfolio-chart-point'}));
    const labels = selected.length > 1 ? [0, .5, 1] : [0];
    for (const fraction of labels) svg.append(svgNode('text', {x: left + fraction * (last - first) / span * (right - left), y: height - 12, 'text-anchor': fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle', class: 'portfolio-chart-label'}, shortDate(first + fraction * (last - first))));
    svg.setAttribute('aria-label', `Cumulative P&L, ${valid.length} observations. Latest ${pct(final.pnlPct)} of initial capital. Use left and right arrow keys to inspect.`);
    inspect(chartPoints.length - 1);
  }
  function render() {
    if (!current) return;
    for (const [id, value] of [['pnl', current.pnlPct], ['unrealized', current.unrealizedPct], ['realized', current.realizedPct]]) {
      const element = $(`portfolio-${id}`); element.textContent = pct(value);
      element.style.color = value == null ? 'var(--dim)' : value < 0 ? 'var(--coral)' : 'var(--lime)';
    }
    $('portfolio-gross').textContent = current.grossPct == null ? '—' : `${current.grossPct.toFixed(2)}%`;
    $('portfolio-net').textContent = current.netPct == null ? 'mark coverage incomplete' : `${pct(current.netPct)} net exposure`;
    positions(); activity(); chart();
  }
  async function getJSON(url) {
    const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw Error(`Source returned HTTP ${response.status}`);
    return response.json();
  }
  async function load() {
    try {
      const [book, marks] = await Promise.all([getJSON('/assets/portfolio/ledger.json'), getJSON('/assets/portfolio/marks.json')]);
      CorbanuPortfolio.validateLedger(book);
      if (marks.schema !== 'corbanu.portfolio-marks.v1' || !Array.isArray(marks.observations)) throw Error('Invalid portfolio observations.');
      if (book.state === 'pending') {
        ledger = book; current = null; observations = []; historicalValues = []; liveObservation = null;
        $('pnl-chart').replaceChildren(); $('portfolio-positions').replaceChildren(); $('portfolio-activity').replaceChildren();
        for (const id of ['pnl', 'unrealized', 'realized', 'gross']) $(`portfolio-${id}`).textContent = '—';
        $('portfolio-position-count').textContent = ''; $('portfolio-net').textContent = 'of initial capital';
        $('portfolio-activity-empty').hidden = false; notice(null); feed('Tracker setup pending', false);
        empty('portfolio-chart-empty', 'Tracker awaiting confirmation', book.reason);
        empty('portfolio-positions-empty', 'Portfolio ledger pending', 'Positions will appear after the tracker book and capital weights are confirmed.');
        return;
      }
      const values = CorbanuPortfolio.history(book, marks.observations); // Validate before replacing a last good view.
      ledger = book; observations = marks.observations; liveObservation = null;
      historicalValues = values;
      const latest = observations[observations.length - 1];
      current = CorbanuPortfolio.valueBook(ledger, new Date().toISOString(), latest?.marks || {});
      feed(latest ? `Recorded marks · ${date(latest.at)}` : 'Waiting for market observations', false);
      $('portfolio-costs').textContent = ledger.costsNote || 'P&L includes only the price changes and cash flows explicitly recorded in the ledger.';
      $('portfolio-history-method').textContent = ledger.historyNote || 'The line uses dated portfolio observations. Period buttons change the visible time range; they do not reset cumulative P&L.';
      notice(current.complete ? ledger.notice : `P&L awaiting marks for ${current.missing.join(', ')}.`);
      render(); await refresh();
    } catch (error) {
      notice(current ? 'Tracker refresh unavailable. Showing the last successfully loaded book and dated marks.' : 'Portfolio data could not be loaded. Please try again shortly.');
      feed('Tracker data unavailable', false);
      if (!current) empty('portfolio-chart-empty', 'Portfolio data unavailable', 'The ledger or market history could not be loaded.');
      console.warn('Portfolio source:', error.message);
    }
  }
  async function refresh() {
    if (refreshing || !ledger || ledger.state !== 'ready' || document.hidden || !navigator.onLine) return;
    const held = current.positions.filter(position => position.quantity);
    if (!held.length) return;
    const native = held.filter(position => position.markAdapter === 'hyperliquid');
    if (!native.length) return;
    refreshing = true;
    try {
      const dexes = [...new Set(native.map(position => position.rawSymbol.includes(':') ? position.rawSymbol.split(':')[0] : ''))];
      const replies = await Promise.all(dexes.map(async dex => {
        const body = {type: 'metaAndAssetCtxs'}; if (dex) body.dex = dex;
        const response = await fetch('https://api.hyperliquid.xyz/info', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(12000)});
        if (!response.ok) throw Error(`Mark feed returned HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload[0]?.universe) || !Array.isArray(payload[1])) throw Error('Invalid venue mark inventory.');
        return Object.fromEntries(payload[0].universe.map((asset, index) => [asset.name, payload[1][index]]));
      }));
      const contexts = Object.assign({}, ...replies), at = new Date().toISOString();
      const marks = {...(liveObservation || observations[observations.length - 1])?.marks};
      for (const position of native) {
        const mark = Number(contexts[position.rawSymbol]?.markPx);
        if (!(Number.isFinite(mark) && mark > 0)) throw Error(`Missing native mark for ${position.symbol}`);
        marks[position.id] = {price: mark, observedAt: at, source: 'Hyperliquid markPx'};
      }
      const value = CorbanuPortfolio.valueBook(ledger, at, marks);
      if (!value.complete) throw Error('Incomplete portfolio mark coverage.');
      liveObservation = {at, marks}; current = value;
      const allLive = held.length === native.length;
      feed(allLive ? `Live marks · ${date(at)}` : `Perps live · other marks dated below`, allLive);
      notice(ledger.notice); render();
    } catch (error) {
      feed(`Live refresh unavailable · marks retained`, false);
      notice([ledger.notice, 'Live marks could not be refreshed. P&L retains the last successful, dated valuation.'].filter(Boolean).join(' '));
      console.warn('Portfolio marks:', error.message);
    } finally { refreshing = false; }
  }
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    period = button.dataset.period;
    document.querySelectorAll('[data-period]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); chart();
  }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); positions();
  }));
  $('pnl-chart').addEventListener('pointermove', event => {
    const bounds = $('pnl-chart').getBoundingClientRect(), x = (event.clientX - bounds.left) / bounds.width * $('pnl-chart').viewBox.baseVal.width;
    if (chartPoints.length) inspect(chartPoints.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(chartPoints[best].x - x) ? index : best, 0));
  });
  $('pnl-chart').addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); inspect(event.key === 'Home' ? 0 : event.key === 'End' ? chartPoints.length - 1 : chartIndex + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  window.addEventListener('resize', chart);
  load(); setInterval(refresh, 30000); setInterval(load, 300000);
})();
