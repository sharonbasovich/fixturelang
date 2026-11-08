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
import { inspectTable } from '../src/inspect.js';
import { needsSourceProtection } from '../src/source-state.js';

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
async function replaceExample(id) {
  const needsConfirmation = needsSourceProtection(await editor.inputValue());
  const confirmation = needsConfirmation ? page.waitForEvent('dialog', { timeout: 5000 }).then(async dialog => {
    assert.equal(dialog.type(), 'confirm');
    assert.match(dialog.message(), /^Replace your custom fixture source/);
    await dialog.accept();
  }) : null;
  await page.getByLabel('Start with').selectOption(id);
  if (confirmation) await confirmation;
}
async function example(id) {
  await replaceExample(id);
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
  await check('Single-column empty CSV downloads preserve row count in both modes', async () => {
    const source = 'fixture empty seed 0 { table strings rows 3 { value: string = pick(""); } table omitted rows 3 { value: string = pick("x") missing every 1; } table nulls rows 3 { value: string = pick("x") null every 1; } }';
    await editor.fill(source);
    await runButton.click();
    await generated('9');
    await page.getByRole('tab', { name: 'CSV', exact: true }).click();
    for (const index of ['0', '1', '2']) {
      await page.locator('#table').selectOption(index);
      for (const mode of ['raw', 'spreadsheet']) {
        await page.getByLabel('CSV export mode').selectOption(mode);
        const expected = 'value\r\n""\r\n""\r\n""\r\n';
        assert.equal(await page.locator('#result-panel pre').textContent(), expected);
        assert.equal(await saveDownload(csvButton, `empty-${index}-${mode}.csv`), expected);
      }
    }
    assert.equal(await saveDownload(jsonButton, 'empty-csv-json.json'), toJSON(await run(source)));
  });
  await check('Source download preserves current edited source', async () => {
    const edited = (await editor.inputValue()) + '\n# saved source';
    await editor.fill(edited);
    const saved = await saveDownload(page.getByRole('button', { name: 'Save source', exact: true }));
    assert.equal(saved, edited);
    assert.equal(await csvButton.isEnabled(), false);
  });
  await check('Custom source survives canceled example replacement; download does not clear its warning', async () => {
    const custom = 'fixture retain seed 5 { table t rows 2 { id: id = seq(1); } }\n# exact note 🪴';
    await editor.fill(custom);
    await runButton.click();await generated('2');
    await editor.evaluate(node => node.setSelectionRange(8, 14));
    const dismissed = page.waitForEvent('dialog').then(async dialog => {
      assert.equal(dialog.type(), 'confirm');
      assert.match(dialog.message(), /^Replace your custom fixture source/);
      await dialog.dismiss();
    });
    await page.getByLabel('Start with').selectOption('related-orders');await dismissed;
    assert.equal(await editor.inputValue(), custom);
    assert.deepEqual(await editor.evaluate(node => [node.selectionStart, node.selectionEnd]), [8, 14]);
    assert.equal(await page.getByLabel('Start with').inputValue(), '');
    assert.equal(await jsonButton.isEnabled(), true);
    assert.equal(await page.locator('#source-protection').isVisible(), true);
    assert.equal(await saveDownload(page.getByRole('button', { name: 'Save source', exact: true })), custom);
    assert.equal(await page.locator('#source-protection').isVisible(), true);
    await replaceExample('related-orders');
    assert.equal(await editor.inputValue(), EXAMPLES.find(item => item.id === 'related-orders').source);
    assert.equal(await page.locator('#source-protection').isVisible(), false);
  });
  await check('Actual reload Cancel preserves custom source; Leave restores the initial example', async () => {
    const custom = 'fixture reload seed 5 { table t rows 2 { id: id = seq(1); } }';
    await editor.fill(custom);await editor.press('End');
    const cancelDialog = page.waitForEvent('dialog');
    const canceledReload = page.reload().then(() => null, error => error);
    const cancel = await cancelDialog;assert.equal(cancel.type(), 'beforeunload');await cancel.dismiss();
    const canceledError = await canceledReload;
    if (canceledError) assert.match(canceledError.message, /ERR_ABORTED|aborted/i);
    assert.equal(await editor.inputValue(), custom);
    assert.equal(await page.locator('#source-protection').isVisible(), true);
    const leaveDialog = page.waitForEvent('dialog');
    const acceptedReload = page.reload();
    const leave = await leaveDialog;assert.equal(leave.type(), 'beforeunload');await leave.accept();
    await acceptedReload;await generated('30');
    assert.equal(await editor.inputValue(), EXAMPLES[0].source);
    assert.equal(await page.locator('#source-protection').isVisible(), false);
  });
  await check('Reduced motion suppresses running pulse; cancel prevents late results', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await replaceExample('bounded-workload');
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
    await replaceExample('bounded-workload');
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
    await replaceExample('importer-edges');
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
  const inspectButton = kind => page.locator(`[data-inspect="${kind}"]`);
  const rowNumbers = () => page.locator('#result-panel tbody .row-index').allTextContents();
  await check('Inspection counts actual cells, isolates records with original row numbers, and preserves full exports', async () => {
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    for (const [kind, count] of Object.entries({ all: 12, duplicate: 3, missing: 3, null: 4 })) {
      assert.equal(await inspectButton(kind).locator('[data-count]').textContent(), String(count));
    }
    await inspectButton('missing').click();
    assert.deepEqual(await rowNumbers(), ['4', '8', '12']);
    assert.equal(await page.locator('.inspected-cell').count(), 3);
    assert.equal(await inspectButton('missing').getAttribute('aria-checked'), 'true');
    assert.match(await status.textContent(), /Exports include all 12 records/);
    assert.equal(await saveDownload(jsonButton, 'inspection-full.json'), toJSON(await run(EXAMPLES[0].source)));
    await page.screenshot({ path: path.join(evidence, 'inspect-missing.png'), fullPage: true });
    await inspectButton('duplicate').click();
    assert.deepEqual(await rowNumbers(), ['4', '8', '12']);
    assert.equal(await page.locator('.value-repeat').count(), 3);
    assert.match(await page.locator('#inspection-note').textContent(), /Reference IDs may repeat normally/);
    await page.screenshot({ path: path.join(evidence, 'inspect-repeat.png'), fullPage: true });
    await inspectButton('null').focus();
    await page.keyboard.press('Space');
    assert.deepEqual(await rowNumbers(), ['3', '6', '9', '12']);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.inspect), 'null');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await inspectButton('missing').getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.inspect), 'missing');
    await page.keyboard.press('Home');
    assert.equal(await inspectButton('all').getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('radiogroup', { name: 'Inspect generated edge cases' }).count(), 1);
    assert.equal(await page.locator('#status').getAttribute('role'), 'status');
    assert.equal(await page.locator('.value-null .sr-only').first().textContent(), 'Explicit null value');
    for (let repeat = 0; repeat < 8; repeat++) {
      await inspectButton('all').click();
      await inspectButton('missing').click();
    }
    assert.deepEqual(await rowNumbers(), ['4', '8', '12']);
  });
  await check('Inspection is scoped per table; JSON and CSV remain unfiltered across format switches', async () => {
    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    assert.equal(await page.locator('#inspection').isVisible(), false);
    assert((await page.locator('#result-panel pre').textContent()).includes('Person 1'));
    await page.getByRole('tab', { name: 'CSV', exact: true }).click();
    await page.getByLabel('CSV export mode').selectOption('raw');
    const data = await run(EXAMPLES[0].source);
    assert.equal(await saveDownload(csvButton, 'inspection-unfiltered.csv'), toCSV(data.tables[0], { mode: 'raw' }).text);
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    assert.deepEqual(await rowNumbers(), ['4', '8', '12']);
    await page.locator('#table').selectOption('1');
    assert.equal(await inspectButton('all').getAttribute('aria-checked'), 'true');
    const counts = inspectTable(data.tables[1]).counts;
    for (const [kind, count] of Object.entries(counts)) assert.equal(await inspectButton(kind).locator('[data-count]').textContent(), String(count));
    await inspectButton('missing').click();
    assert.equal(await page.locator('#result-panel tbody tr').count(), 0);
    assert.equal(await page.locator('#result-panel table').count(), 0);
    assert.match(await page.locator('#result-panel .placeholder').textContent(), /No records with missing keys in signups/);
    await page.screenshot({ path: path.join(evidence, 'inspect-empty.png'), fullPage: true });
  });
  await check('Inspection does not admit stale, interrupted or erroneous results; successful runs reset the filter', async () => {
    await editor.fill('fixture bad seed 1 {');
    assert.equal(await inspectButton('missing').isEnabled(), false);
    assert.match(await page.locator('#inspection-note').textContent(), /^Previous result/);
    await runButton.click();
    await page.locator('#diagnostic').waitFor({ state: 'visible' });
    assert.equal(await inspectButton('all').isEnabled(), false);
    await replaceExample('bounded-workload');
    await runButton.click();
    assert.equal(await inspectButton('all').isEnabled(), false);
    await page.locator('#cancel').click();
    await page.waitForTimeout(300);
    assert.equal(await inspectButton('all').isEnabled(), false);
    await example('importer-edges');
    await generated('30');
    assert.equal(await inspectButton('all').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#result-panel tbody tr').count(), 12);
  });
  await check('Inspection finds edge cases beyond the unfiltered preview and stays bounded on the maximum fixture', async () => {
    await editor.fill('fixture later seed 1 { table t rows 1000 { id: id = seq(1); value: string = pick("ok") missing every 150; } }');
    await runButton.click();await generated('1,000');
    assert.equal(await page.locator('.value-missing').count(), 0);
    assert.equal(await inspectButton('missing').locator('[data-count]').textContent(), '6');
    await inspectButton('missing').click();
    assert.deepEqual(await rowNumbers(), ['150', '300', '450', '600', '750', '900']);
    await example('bounded-workload');await generated('20,000');
    await inspectButton('missing').click();
    assert.equal(await page.locator('#result-panel tbody tr').count(), 100);
    assert.equal(await inspectButton('missing').locator('[data-count]').textContent(), '1,000');
    assert.equal((await rowNumbers())[0], '10');
    assert.equal((await rowNumbers()).at(-1), '1000');
    const sample = await page.evaluate(async () => {
      const { inspectTable } = await import('/src/inspect.js');
      const { run } = await import('/src/language.js');
      const { EXAMPLES } = await import('/src/examples.js');
      const data = await run(EXAMPLES[3].source);
      const start = performance.now();
      const inspected = data.tables.map(inspectTable);
      return { milliseconds: performance.now() - start, records: inspected.reduce((sum, result) => sum + result.rows.length, 0) };
    });
    assert.equal(sample.records, 20000);
    await writeFile(path.join(evidence, 'inspection-performance.json'), JSON.stringify({ ...sample, note: 'One desktop Chromium sample, not a cross-device benchmark or guaranteed budget.' }, null, 2));
  });
  await check('Inspection works at 390px/320px, keyboard activation and reduced motion without layout overflow', async () => {
    await example('importer-edges');await generated('30');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await inspectButton('null').focus();await page.keyboard.press('Enter');
      assert.deepEqual(await rowNumbers(), ['3', '6', '9', '12']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await inspectButton('null').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
      assert((await inspectButton('null').boundingBox()).height >= 44);
      const frame = await page.locator('#result-panel').boundingBox();
      const cell = await page.locator('.inspected-cell').first().boundingBox();
      const rowIndex = await page.locator('#result-panel tbody .row-index').first().boundingBox();
      assert(cell.x >= rowIndex.x + rowIndex.width && cell.x + cell.width <= frame.x + frame.width);
      assert(rowIndex.x >= frame.x && rowIndex.x < frame.x + 3);
      await page.screenshot({ path: path.join(evidence, `inspect-mobile-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
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
