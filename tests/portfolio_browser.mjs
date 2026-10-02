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
let mode = 'ready', rejectMarks = false, markReads = 0;
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('https://corbanu.com/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/assets/portfolio/ledger.json') return route.fulfill({json: mode === 'pending' ? {schema: 'corbanu.portfolio.v1', state: 'pending', reason: 'Synthetic pending state'} : ledger});
  if (path === '/assets/portfolio/marks.json') return route.fulfill({json: marks});
  const file = resolve(root, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
  try { await route.fulfill({contentType: {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'}[extname(file)] || 'image/png', body: await readFile(file)}); }
  catch { await route.fulfill({status: 404}); }
});
await page.route('https://api.hyperliquid.xyz/**', async route => {
  markReads++;
  assert.deepEqual(route.request().postDataJSON(), {type: 'metaAndAssetCtxs', dex: 'xyz'});
  if (rejectMarks) return route.fulfill({status: 503, body: 'Fixture failure'});
  return route.fulfill({json: [{universe: [{name: 'xyz:SHORT'}, {name: 'xyz:LONG'}]}, [{markPx: '80', midPx: '400'}, {markPx: '65', midPx: '450'}]]});
});
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
  mode = 'pending'; await page.reload();
  await page.getByRole('heading', {name: 'Tracker awaiting confirmation'}).waitFor();
  assert.equal(await page.locator('#portfolio-pnl').textContent(), '—');
  assert.equal(await page.locator('.portfolio-chart-line').count(), 0);
  const count = markReads; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  assert.equal(markReads, count);
  assert.deepEqual(errors, []);
  console.log('Portfolio browser checks passed: native markPx, realized/unrealized totals, dated statuses, filters, chart controls, retained failure, mobile layout, and pending book. Synthetic data only.');
} finally { await browser.close(); }
