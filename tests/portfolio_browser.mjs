import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
const {chromium} = await import(process.env.CORBANU_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(new URL('..', import.meta.url).pathname);
const evidence = process.env.CORBANU_PORTFOLIO_EVIDENCE;
if (evidence) await mkdir(evidence, {recursive: true});
const browser = await chromium.launch({headless: true}), page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const now = Date.now(), at = days => new Date(now - days * 86400000).toISOString();
const ledger = {schema: 'corbanu.portfolio.v1', state: 'ready', initialCapital: 1000, inception: at(12), name: 'Synthetic test book', notice: 'Synthetic preview — test data, not Corbanu performance.', costsNote: 'Synthetic calculation fixtures; price P&L only.', positions: [
  {id: 'short', symbol: 'SHORT', name: 'Synthetic short', rawSymbol: 'xyz:SHORT', venue: 'Fixture venue', markAdapter: 'hyperliquid', href: '/cbrs/', articleHref: '/posts/cerebras-left-on-the-bench/'},
  {id: 'long', symbol: 'LONG', name: 'Synthetic long', rawSymbol: 'xyz:LONG', venue: 'Fixture venue', markAdapter: 'hyperliquid', href: '/cxmt/'},
  {id: 'closed', symbol: 'CLOSED', name: 'Synthetic closed', venue: 'Fixture venue'},
], events: [
  {id: 's1', type: 'trade', positionId: 'short', at: at(12), quantity: -5, price: 100},
  {id: 'l1', type: 'trade', positionId: 'long', at: at(12), quantity: 4, price: 50},
  {id: 'c1', type: 'trade', positionId: 'closed', at: at(11), quantity: 1, price: 100},
  {id: 's2', type: 'trade', positionId: 'short', at: at(9), quantity: -2, price: 90},
  {id: 'l2', type: 'trade', positionId: 'long', at: at(6), quantity: -1, price: 60},
  {id: 'c2', type: 'trade', positionId: 'closed', at: at(4), quantity: -1, price: 120},
]};
const marks = {schema: 'corbanu.portfolio-marks.v1', observations: [12, 11, 9, 8, 6, 4, 1].map(days => ({at: at(days), marks: Object.fromEntries([['short', 100 - (12 - days)], ['long', 50 + (12 - days)], ['closed', 100 + 2 * (12 - days)]].map(([id, price]) => [id, {price, observedAt: at(days), source: 'synthetic historical mark'}]))}))};
const fixtureMetric = value => ({value, observedAt: at(1)});
const statistics = {schema: 'corbanu.portfolio-statistics.v1', positions: {
  short: {rawSymbol: 'xyz:SHORT', metrics: {forwardPE: fixtureMetric(40), forwardSalesGrowthPct: fixtureMetric(5), forwardEPSGrowthPct: fixtureMetric(-2), sevenDayFundingAprPct: fixtureMetric(-5), epsRevision28dPctOfPrice: fixtureMetric(0)}},
  long: {rawSymbol: 'xyz:LONG', metrics: {forwardPE: fixtureMetric(20), forwardSalesGrowthPct: fixtureMetric(30), forwardEPSGrowthPct: fixtureMetric(50), sevenDayFundingAprPct: fixtureMetric(10), epsRevision28dPctOfPrice: fixtureMetric(1)}},
}};
let mode = 'ready', rejectMarks = false, rejectStatistics = false, markReads = 0;
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('https://corbanu.com/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/assets/portfolio/ledger.json') return route.fulfill({json: mode === 'pending' ? {schema: 'corbanu.portfolio.v1', state: 'pending', reason: 'Synthetic pending state'} : ledger});
  if (path === '/assets/portfolio/marks.json') return route.fulfill({json: marks});
  if (path === '/assets/portfolio/statistics.json') return rejectStatistics ? route.fulfill({status: 503}) : route.fulfill({json: statistics});
  const file = resolve(root, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
  try { await route.fulfill({contentType: {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'}[extname(file)] || 'image/png', body: await readFile(file)}); }
  catch { await route.fulfill({status: 404}); }
});
await page.route('https://api.hyperliquid.xyz/**', async route => {
  const body = route.request().postDataJSON();
  if (body.type === 'candleSnapshot') {
    assert.equal(body.req.interval, '1d');
    const end = Math.floor(now / 86400000) * 86400000 - 1;
    return route.fulfill({json: Array.from({length: 14}, (_, i) => {
      const T = end - (13 - i) * 86400000;
      return {s: body.req.coin, i: '1d', t: T - 86400000 + 1, T, c: String(100 + i * 2 + Math.sin(i))};
    })});
  }
  markReads++;
  assert.deepEqual(body, {type: 'metaAndAssetCtxs', dex: 'xyz'});
  if (rejectMarks) return route.fulfill({status: 503, body: 'Fixture failure'});
  const native = ledger.positions.filter(row => row.markAdapter === 'hyperliquid');
  return route.fulfill({json: [{universe: native.map(row => ({name: row.rawSymbol}))}, native.map(row => ({markPx: String({short: 80, long: 65, added: 12}[row.id]), midPx: '400'}))]});
});
await page.clock.install({time: new Date(now)});
try {
  await page.goto('https://corbanu.com/portfolio/');
  await page.waitForFunction(() => document.querySelector('#portfolio-feed').classList.contains('is-live'));
  assert.equal(await page.locator('#portfolio-pnl').textContent(), '+19.50%');
  assert.equal(await page.locator('#portfolio-unrealized').textContent(), '+16.50%');
  assert.equal(await page.locator('#portfolio-realized').textContent(), '+3.00%');
  assert.equal(await page.locator('#portfolio-positions tr').count(), 2);
  assert.match(await page.locator('#portfolio-positions').textContent(), /\$80.00/);
  assert.doesNotMatch(await page.locator('#portfolio-positions').textContent(), /\$400.00/);
  assert.equal(await page.locator('#portfolio-activity li').count(), 6);
  assert.equal(await page.locator('#portfolio-statistics [data-metric="forwardPE"] [data-side="long"] strong').textContent(), '20.00×');
  assert.equal(await page.locator('#portfolio-statistics [data-metric="forwardPE"] [data-side="short"] strong').textContent(), '40.00×');
  assert.equal(await page.locator('#portfolio-statistics [data-metric="epsRevision28dPctOfPrice"] [data-side="short"] strong').textContent(), '+0.00%');
  assert.match(await page.locator('#portfolio-statistics [data-metric="sevenDayFundingAprPct"] [data-side="short"]').textContent(), /Carry −5.00% APR/);
  assert.equal(await page.evaluate(() => document.querySelector('#statistics-title').closest('section').previousElementSibling.getAttribute('aria-labelledby')), 'positions-title');
  assert.match(await page.locator('#portfolio-activity').textContent(), /Added/);
  assert.match(await page.locator('#portfolio-activity').textContent(), /Cut/);
  assert.match(await page.locator('#portfolio-activity').textContent(), /Exited/);
  await page.getByRole('button', {name: 'Exited', exact: true}).click();
  assert.equal(await page.locator('#portfolio-positions tr').count(), 1);
  assert.match(await page.locator('#portfolio-positions').textContent(), /CLOSED/);
  await page.getByRole('button', {name: 'Current', exact: true}).click();
  await page.getByRole('button', {name: '1W', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: '1W', exact: true}).getAttribute('aria-pressed'), 'true');
  await page.locator('#pnl-chart').focus(); await page.keyboard.press('Home');
  assert.match(await page.locator('#portfolio-chart-readout').textContent(), /UTC/);
  const first = await page.locator('#portfolio-chart-readout').textContent(); await page.keyboard.press('End');
  assert.notEqual(await page.locator('#portfolio-chart-readout').textContent(), first);
  await page.getByRole('button', {name: 'All', exact: true}).first().click();
  if (evidence) await page.screenshot({path: resolve(evidence, 'portfolio-desktop-synthetic.png'), fullPage: true});
  const before = await page.locator('#portfolio-pnl').textContent(); rejectMarks = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('#portfolio-feed-text').textContent.includes('unavailable'));
  assert.equal(await page.locator('#portfolio-pnl').textContent(), before);
  assert.match(await page.locator('#portfolio-notice').textContent(), /retains/);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.getByRole('navigation', {name: 'Primary navigation'}).isVisible(), true);
  if (evidence) await page.screenshot({path: resolve(evidence, 'portfolio-mobile-synthetic.png'), fullPage: true});
  assert.equal(await page.locator('#portfolio-statistics tr').count(), 5);
  assert.equal(await page.locator('#portfolio-statistics td').count(), 10);
  ledger.positions.push({id: 'added', symbol: 'NEW_FIXTURE', name: 'New synthetic holding', rawSymbol: 'xyz:NEW_FIXTURE', venue: 'Fixture venue', markAdapter: 'hyperliquid'});
  ledger.events.push({id: 'new-entry', type: 'trade', positionId: 'added', at: at(0), quantity: 3, price: 10, targetWeightPct: 3});
  statistics.positions.added = {rawSymbol: 'xyz:NEW_FIXTURE', metrics: {forwardPE: fixtureMetric(10), forwardSalesGrowthPct: fixtureMetric(0), forwardEPSGrowthPct: fixtureMetric(0), sevenDayFundingAprPct: fixtureMetric(0), epsRevision28dPctOfPrice: {...fixtureMetric(0), basis: '8-observation window'}}};
  await page.clock.fastForward(300001);
  await page.waitForFunction(() => document.querySelector('#portfolio-statistics [data-metric="forwardPE"] [data-side="long"] strong').textContent === '18.33×');
  assert.match(await page.locator('#portfolio-long-summary').textContent(), /2 positions/);
  assert.match(await page.locator('#portfolio-statistics-notes').textContent(), /8-observation window/);
  assert.equal(await page.locator('#portfolio-positions tr').count(), 3);
  assert.equal(await page.locator('#portfolio-statistics [data-metric="forwardPE"] [data-side="short"] strong').textContent(), '40.00×');
  rejectStatistics = true;
  await page.clock.fastForward(300001);
  await page.waitForFunction(() => document.querySelector('#portfolio-statistics-status').textContent.includes('retained'));
  assert.equal(await page.locator('#portfolio-statistics [data-metric="forwardPE"] [data-side="long"] strong').textContent(), '18.33×');
  mode = 'pending'; await page.reload();
  await page.getByRole('heading', {name: 'Tracker awaiting confirmation'}).waitFor();
  assert.equal(await page.locator('#portfolio-pnl').textContent(), '—');
  assert.equal(await page.locator('.portfolio-chart-line').count(), 0);
  const count = markReads; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  assert.equal(markReads, count);
  assert.deepEqual(errors, []);
  console.log('Portfolio browser checks passed: native markPx, realized/unrealized totals, dated statuses, filters, chart controls, retained failure, unified statistics table, arbitrary new holdings, updated weighted averages, dated coverage, failed statistics reload retention, mobile layout, and pending book. Synthetic data only.');
} finally { await browser.close(); }
