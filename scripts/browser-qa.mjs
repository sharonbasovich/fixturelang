// Optional development QA. Production and ordinary tests have no dependencies.
// Point FIXTURELANG_PLAYWRIGHT at an already installed playwright-core package.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createStaticServer, PROJECT_ROOT } from './server.mjs';
import { EXAMPLES } from '../src/examples.js';
import { run } from '../src/language.js';
import { toJSON, toCSV } from '../src/export.js';

const require = createRequire(import.meta.url);
const playwright = require(process.env.FIXTURELANG_PLAYWRIGHT || 'playwright-core');
const evidence = path.join(PROJECT_ROOT, 'evidence');
await mkdir(path.join(evidence, 'downloads'), { recursive: true });
const server = createStaticServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
const failures = [];
const externalRequests = [];
const checks = [];
page.on('pageerror', error => failures.push(error.message));
page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  externalRequests.push(route.request().url());
  return route.abort();
});
const status = page.locator('#status');
const editor = page.getByRole('textbox', { name: 'FixtureLang source' });
const runButton = page.getByRole('button', { name: 'Run fixture', exact: true });
const csvButton = page.getByRole('button', { name: '↓ CSV table', exact: true });
const jsonButton = page.getByRole('button', { name: '↓ JSON dataset', exact: true });

async function check(name, work) {
  const start = performance.now();
  await work();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}
async function generated(rows) {
  await page.waitForFunction(count => document.getElementById('status').textContent.startsWith(`Generated ${count} rows`), rows, { timeout: 10_000 });
  assert.equal(await runButton.isEnabled(), true);
  assert.equal(await jsonButton.isEnabled(), true);
}
async function example(id) {
  await page.getByLabel('Start with').selectOption(id);
  assert.equal(await jsonButton.isEnabled(), false);
  await runButton.click();
}
async function saveDownload(button, filename) {
  const downloadEvent = page.waitForEvent('download');
  await button.click();
  const download = await downloadEvent;
  const target = path.join(evidence, 'downloads', filename || download.suggestedFilename());
  await download.saveAs(target);
  assert.equal(await download.failure(), null);
  return readFile(target, 'utf8');
}
const hash = text => createHash('sha256').update(text).digest('hex');

try {
  await check('Initial real worker generation, missing/null markers, and desktop layout', async () => {
    await page.goto(origin);
    await generated('30');
    assert.equal(await page.getByRole('table', { name: 'people generated records' }).locator('tbody tr').count(), 12);
    assert.equal(await page.locator('.value-missing').count(), 3);
    assert.equal(await page.locator('.value-null').count(), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(evidence, 'desktop.png'), fullPage: true });
  });
  await check('JSON download equals interpreter; repeated runs have byte-identical exports', async () => {
    const expected = toJSON(await run(EXAMPLES[0].source));
    const initial = await saveDownload(jsonButton);
    assert.equal(initial, expected);
    for (let repeat = 0; repeat < 2; repeat++) {
      await runButton.click();
      await generated('30');
      const again = await saveDownload(jsonButton, `repeat-${repeat}.json`);
      assert.equal(hash(again), hash(initial));
    }
  });
  await check('Table selection, JSON tab and arrow-key tab focus', async () => {
    await page.getByRole('combobox', { name: 'Table', exact: true }).selectOption('1');
    assert.equal(await page.getByRole('table', { name: 'signups generated records' }).locator('tbody tr').count(), 18);
    await page.getByRole('tab', { name: 'Table', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'JSON', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-json');
    assert.ok((await page.locator('#result-panel pre').textContent()).includes('"signups"'));
  });
  await check('Editor invalidates exports; keyboard run, exact diagnostic and focus jump', async () => {
    await editor.fill('fixture broken seed 4 {\n  table rows rows 2 {\n    id: id = seq(1)\n  }\n}');
    assert.equal(await jsonButton.isEnabled(), false);
    assert.equal(await page.locator('#stale').isVisible(), true);
    await editor.press('Control+Enter');
    await page.locator('#diagnostic').waitFor({ state: 'visible' });
    assert.equal(await editor.getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#diagnostic-message').textContent(), /Expected ";" or/);
    assert.match(await page.locator('#diagnostic-title').textContent(), /^SYNTAX · 4:3$/);
    await page.getByRole('button', { name: 'Go to error' }).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source');
    assert.equal(await editor.evaluate(node => node.selectionStart), 68);
    await page.screenshot({ path: path.join(evidence, 'diagnostic.png'), fullPage: true });
    await editor.fill('fixture huge seed 0 { table t rows 10001 { id: id = seq(1); } }');
    assert.equal(await editor.getAttribute('aria-invalid'), null);
    await editor.press('Control+Enter');
    await page.waitForFunction(() => document.getElementById('diagnostic-title').textContent.startsWith('LIMIT'));
    assert.equal(await jsonButton.isEnabled(), false);
  });
  await check('CSV requires explicit mode; raw/safe downloads retain intended distinctions', async () => {
    await example('csv-boundaries');
    await generated('16');
    await page.getByRole('tab', { name: 'CSV', exact: true }).click();
    assert.equal(await csvButton.isEnabled(), false);
    assert.equal(await page.getByLabel('CSV export mode').inputValue(), '');
    const data = await run(EXAMPLES.find(item => item.id === 'csv-boundaries').source);
    await page.getByLabel('CSV export mode').selectOption('raw');
    const raw = await saveDownload(csvButton);
    assert.equal(raw, toCSV(data.tables[0], { mode: 'raw' }).text);
    await page.getByLabel('CSV export mode').selectOption('spreadsheet');
    const safe = await saveDownload(csvButton);
    const safeResult = toCSV(data.tables[0], { mode: 'spreadsheet' });
    assert.equal(safe, safeResult.text);
    assert.ok(safeResult.protectedCells > 0);
    assert.notEqual(raw, safe);
    assert.match(await status.textContent(), new RegExp(`${safeResult.protectedCells} cells protected`));
    assert.equal(await saveDownload(jsonButton, 'after-csv.json'), toJSON(data));
    await page.screenshot({ path: path.join(evidence, 'csv-choice.png'), fullPage: true });
  });
  await check('Source download preserves current edited source', async () => {
    const edited = (await editor.inputValue()) + '\n# saved source';
    await editor.fill(edited);
    const saved = await saveDownload(page.getByRole('button', { name: 'Save source', exact: true }));
    assert.equal(saved, edited);
    assert.equal(await csvButton.isEnabled(), false);
  });
  await check('Reduced motion suppresses running pulse; cancel prevents late results', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByLabel('Start with').selectOption('bounded-workload');
    await runButton.click();
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.locator('#status-dot').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.match(await status.textContent(), /^Cancelled/);
    assert.equal(await jsonButton.isEnabled(), false);
    await page.waitForTimeout(1300);
    assert.match(await status.textContent(), /^Cancelled/);
    await example('related-orders');
    await generated('18');
    await page.waitForTimeout(300);
    assert.match(await status.textContent(), /Seed 42/);
  });
  await check('20,000-row browser execution; previews stay bounded and JSON download is complete', async () => {
    await example('bounded-workload');
    await generated('20,000');
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    assert.equal(await page.locator('#result-panel tbody tr').count(), 100);
    const full = JSON.parse(await saveDownload(jsonButton, 'maximum-workload.json'));
    assert.equal(full.tables.users.length, 10_000);
    assert.equal(full.tables.events.length, 10_000);
  });
  await check('Editing stops active work; navigation restore leaves Run usable', async () => {
    await runButton.click();
    await editor.fill('fixture edited seed 5 { table t rows 1 { id: id = seq(1); } }');
    assert.equal(await runButton.isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), false);
    await editor.press('Control+Enter');
    await generated('1');
    await page.getByLabel('Start with').selectOption('bounded-workload');
    await runButton.click();
    await page.goto(origin + '/docs/language-reference.md');
    await page.goBack();
    await page.waitForFunction(() => !document.getElementById('run').disabled);
    assert.equal(await runButton.isEnabled(), true);
    await example('related-orders');
    await generated('18');
  });
  await check('Mobile 390px and 320px: no page overflow, editable source and working run/export', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await example('importer-edges');
    await generated('30');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await page.screenshot({ path: path.join(evidence, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await editor.fill('fixture mobile seed 9 { table t rows 2 { id: id = seq(1); } }');
    await editor.press('Control+Enter');
    await generated('2');
    assert.equal(JSON.parse(await saveDownload(jsonButton, 'mobile.json')).tables.t.length, 2);
    await page.screenshot({ path: path.join(evidence, 'mobile-320.png'), fullPage: true });
  });
  await check('Keyboard-only skip link and visible focus; documentation routes', async () => {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(origin);
    await generated('30');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
    assert.equal(await page.locator('.skip').evaluate(node => getComputedStyle(node).outlineWidth), '3px');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'source');
    for (const route of ['/docs/language-reference.md', '/docs/demo-outline.md']) {
      const response = await context.request.get(origin + route);
      assert.equal(response.status(), 200);
    }
  });
  await check('No page/console errors and no external requests', async () => {
    assert.deepEqual(failures, []);
    assert.deepEqual(externalRequests, []);
  });
} catch (error) {
  checks.push({ name: 'QA failure', passed: false, detail: error.stack });
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'browser-results.json'), JSON.stringify({
    browser: await browser.version(), platform: process.platform,
    mode: 'isolated Chromium QA',
    checks, consoleErrors: failures, externalRequests,
  }, null, 2) + '\n');
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
