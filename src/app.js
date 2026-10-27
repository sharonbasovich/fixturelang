import { EXAMPLES } from './examples.js';
import { toCSV, toJSON } from './export.js';

const $ = (id) => document.getElementById(id);
const source = $('source');
const exampleSelect = $('example');
const tableSelect = $('table');
const modeSelect = $('csv-mode');
const panel = $('result-panel');
const tabs = ['table', 'json', 'csv'];
let dataset = null;
let worker = null;
let fresh = false;
let activeTab = 'table';
let diagnostic = null;
let runSerial = 0;
let resultSource = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(message, kind = 'ready') {
  $('status').textContent = message;
  $('status-dot').className = `status-dot ${kind}`;
}

function controls() {
  $('run').disabled = worker !== null;
  $('cancel').disabled = worker === null;
  $('download-json').disabled = !dataset || !fresh || worker !== null;
  $('download-csv').disabled = !dataset || !fresh || !modeSelect.value || worker !== null;
  tableSelect.disabled = !dataset;
  $('stale').hidden = !dataset || fresh;
  $('stale').textContent = worker
    ? 'Generating… previous result shown. Exports wait for completion.'
    : source.value === resultSource
      ? 'Previous result shown. Run again to enable exports.'
      : 'Source changed. Run again to update this result and enable exports.';
}

function stop(message = 'Cancelled. No partial data was kept.') {
  if (!worker) return;
  worker.terminate();
  worker = null;
  runSerial += 1;
  fresh = false;
  controls();
  status(message);
}

function cursor() {
  const prefix = source.value.slice(0, source.selectionStart);
  const lines = prefix.split('\n');
  $('cursor').textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

function editorMetrics() {
  const count = source.value.split('\n').length;
  $('line-numbers').textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  $('source-limit').textContent = `${source.value.length.toLocaleString('en-US')} / 65,536 characters`;
  cursor();
}

function edit() {
  stop('Source edited. Run again when ready.');
  fresh = false;
  diagnostic = null;
  source.removeAttribute('aria-invalid');
  $('diagnostic').hidden = true;
  exampleSelect.value = '';
  $('example-description').textContent = 'Your custom fixture. Nothing leaves this browser.';
  editorMetrics();
  controls();
  status(dataset ? 'Source changed. Previous result is out of date.' : 'Ready to run your source.');
}

function showDiagnostic(error) {
  diagnostic = error;
  source.setAttribute('aria-invalid', 'true');
  $('diagnostic').hidden = false;
  $('diagnostic-title').textContent = `${error.code} · ${error.line}:${error.column}`;
  $('diagnostic-message').textContent = error.message;
  const line = source.value.split(/\r\n|\r|\n/)[error.line - 1] || '';
  const offset = Math.max(0, error.column - 65);
  const excerpt = line.slice(offset, offset + 160);
  $('diagnostic-excerpt').textContent = `${offset ? '…' : ''}${excerpt}\n${' '.repeat(Math.min(64, Math.max(0, error.column - 1)) + (offset ? 1 : 0))}^`;
  status(`${error.code} at line ${error.line}, column ${error.column}. ${error.message}`, 'error');
}

function runFixture() {
  stop();
  fresh = false;
  diagnostic = null;
  source.removeAttribute('aria-invalid');
  $('diagnostic').hidden = true;
  status('Parsing and generating in an isolated worker…', 'running');
  const serial = ++runSerial;
  const requestedSource = source.value;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data }) => {
      if (serial !== runSerial) return;
      if (data.type === 'progress') {
        const { rows, totalRows } = data.progress;
        if (rows > 0 && rows % 1024 === 0) status(`Generating ${rows.toLocaleString('en-US')} of ${totalRows.toLocaleString('en-US')} rows…`, 'running');
        return;
      }
      worker.terminate();
      worker = null;
      if (data.type === 'error') {
        controls();
        showDiagnostic(data.diagnostic);
        return;
      }
      dataset = data.dataset;
      resultSource = requestedSource;
      fresh = true;
      tableSelect.replaceChildren(...dataset.tables.map((table, index) => {
        const option = element('option', table.name);
        option.value = String(index);
        return option;
      }));
      $('seed-label').textContent = `seed ${dataset.seed}`;
      controls();
      render();
      status(`Generated ${dataset.stats.rows.toLocaleString('en-US')} rows across ${dataset.tables.length} ${dataset.tables.length === 1 ? 'table' : 'tables'}. Seed ${dataset.seed}.`);
    });
    worker.addEventListener('error', () => {
      if (serial !== runSerial) return;
      stop();
      showDiagnostic({ code: 'WORKER', message: 'Could not start the local worker. Serve this folder with npm start, then reload.', line: 1, column: 1 });
    });
    worker.postMessage({ source: source.value });
  } catch {
    if (worker) worker.terminate();
    worker = null;
    showDiagnostic({ code: 'WORKER', message: 'This browser could not start a module worker. Use a current browser through the local server.', line: 1, column: 1 });
  }
  controls();
}

function csvExplanation(result) {
  if (!modeSelect.value) return 'Choose a mode before previewing or downloading CSV.';
  const extra = result ? ` ${result.protectedCells} ${result.protectedCells === 1 ? 'cell' : 'cells'} protected in this preview.` : '';
  if (modeSelect.value === 'raw') return 'Exact raw payload: formula-like strings stay unchanged. Use for importer tests; opening in a spreadsheet may interpret formulas. Missing and null are empty cells.';
  return `Spreadsheet-safe: a leading apostrophe is added to formula-like text. This changes the test payload; numeric negatives stay numeric.${extra} Missing and null are empty cells.`;
}

function renderTable(table) {
  const grid = element('table');
  grid.setAttribute('aria-label', `${table.name} generated records`);
  const head = element('thead');
  const headers = element('tr');
  const numberHeader = element('th', '#', 'row-index');
  numberHeader.scope = 'col';
  headers.append(numberHeader);
  for (const field of table.fields) {
    const th = element('th', field.name);
    th.scope = 'col';
    th.append(element('small', field.type));
    headers.append(th);
  }
  head.append(headers);
  const body = element('tbody');
  table.rows.slice(0, 100).forEach((record, index) => {
    const row = element('tr');
    row.append(element('td', String(index + 1), 'row-index'));
    for (const field of table.fields) {
      const cell = element('td');
      if (!Object.hasOwn(record, field.name)) cell.append(element('span', 'missing', 'value-missing'));
      else if (record[field.name] === null) cell.append(element('span', 'null', 'value-null'));
      else if (record[field.name] === '') cell.append(element('span', '""', 'empty-string'));
      else {
        cell.textContent = String(record[field.name]);
        cell.title = String(record[field.name]);
        if (typeof record[field.name] === 'boolean') cell.className = 'value-bool';
      }
      row.append(cell);
    }
    body.append(row);
  });
  grid.append(head, body);
  panel.append(grid);
  if (!table.rows.length) panel.append(element('p', 'This table intentionally contains zero rows.', 'placeholder'));
}

function render() {
  $('csv-options').hidden = activeTab !== 'csv';
  $('csv-explanation').textContent = csvExplanation();
  $('result-panel').setAttribute('aria-labelledby', `tab-${activeTab}`);
  if (!dataset) return;
  const table = dataset.tables[Number(tableSelect.value) || 0];
  $('row-count').textContent = `${table.rows.length.toLocaleString('en-US')} rows`;
  panel.replaceChildren();
  $('preview-note').textContent = activeTab === 'json'
    ? 'JSON preview: first 100 rows per table. Download includes all rows.'
    : `${Math.min(100, table.rows.length)} of ${table.rows.length.toLocaleString('en-US')} rows · download includes all rows`;
  if (activeTab === 'table') renderTable(table);
  if (activeTab === 'json') {
    const preview = { ...dataset, tables: dataset.tables.map((item) => ({ ...item, rows: item.rows.slice(0, 100) })) };
    panel.append(element('pre', toJSON(preview)));
  }
  if (activeTab === 'csv') {
    if (!modeSelect.value) panel.append(element('p', 'Choose an explicit CSV mode above. Exact raw keeps hostile strings intact. Spreadsheet-safe changes formula-like text.', 'placeholder'));
    else {
      const result = toCSV({ ...table, rows: table.rows.slice(0, 100) }, { mode: modeSelect.value });
      panel.append(element('pre', result.text));
      $('csv-explanation').textContent = csvExplanation(result);
    }
  }
}

function tabSelect(tab, focus = false) {
  activeTab = tab;
  for (const name of tabs) {
    $(`tab-${name}`).setAttribute('aria-selected', String(name === tab));
    $(`tab-${name}`).tabIndex = name === tab ? 0 : -1;
  }
  if (focus) $(`tab-${tab}`).focus();
  render();
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadExample(id) {
  const example = EXAMPLES.find((item) => item.id === id);
  if (!example) return;
  stop('Example loaded. Run when ready.');
  source.value = example.source;
  source.setSelectionRange(0, 0);
  fresh = false;
  $('diagnostic').hidden = true;
  $('example-description').textContent = example.description;
  source.removeAttribute('aria-invalid');
  editorMetrics();
  controls();
  status(`${example.title} loaded. Run fixture to generate data.`);
}

exampleSelect.append(element('option', 'Custom source'));
exampleSelect.firstElementChild.value = '';
for (const example of EXAMPLES) {
  const option = element('option', example.title);
  option.value = example.id;
  exampleSelect.append(option);
}
exampleSelect.addEventListener('change', () => loadExample(exampleSelect.value));
source.addEventListener('input', edit);
source.addEventListener('scroll', () => { $('line-numbers').scrollTop = source.scrollTop; });
source.addEventListener('click', cursor);
source.addEventListener('keyup', cursor);
source.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    if (!worker) runFixture();
  }
});
$('run').addEventListener('click', runFixture);
$('cancel').addEventListener('click', () => stop());
tableSelect.addEventListener('change', render);
modeSelect.addEventListener('change', () => { controls(); render(); });
tabs.forEach((tab, index) => {
  $(`tab-${tab}`).addEventListener('click', () => tabSelect(tab));
  $(`tab-${tab}`).addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    tabSelect(tabs[next], true);
  });
});
$('jump-error').addEventListener('click', () => {
  if (!diagnostic) return;
  const starts = [...source.value.matchAll(/\r\n|\r|\n/g)];
  const lineStart = diagnostic.line <= 1 ? 0 : (starts[diagnostic.line - 2]?.index ?? 0) + (starts[diagnostic.line - 2]?.[0].length ?? 0);
  const offset = Math.min(source.value.length, lineStart + diagnostic.column - 1);
  source.focus();
  source.setSelectionRange(offset, Math.min(source.value.length, offset + 1));
  source.scrollTop = Math.max(0, (diagnostic.line - 4) * 21.6);
  $('line-numbers').scrollTop = source.scrollTop;
  cursor();
});
$('download-json').addEventListener('click', () => {
  if (!fresh || !dataset) return;
  download(toJSON(dataset), `${dataset.name}.json`, 'application/json;charset=utf-8');
  status(`Downloaded the full JSON dataset for ${dataset.name}; missing keys and nulls are preserved.`);
});
$('download-csv').addEventListener('click', () => {
  if (!fresh || !dataset || !modeSelect.value) return;
  const table = dataset.tables[Number(tableSelect.value) || 0];
  const result = toCSV(table, { mode: modeSelect.value });
  download(result.text, `${dataset.name}-${table.name}-${modeSelect.value}.csv`, 'text/csv;charset=utf-8');
  status(`Downloaded ${table.rows.length.toLocaleString('en-US')} rows as ${modeSelect.value === 'raw' ? 'exact raw' : 'spreadsheet-safe'} CSV. ${result.protectedCells} cells protected; ${result.missingCells} missing and ${result.nullCells} null cells exported as empty.`);
});
$('download-source').addEventListener('click', () => {
  download(source.value, fresh && dataset ? `${dataset.name}.fixture` : 'source.fixture', 'text/plain;charset=utf-8');
  status('Downloaded the current FixtureLang source.');
});
window.addEventListener('pagehide', () => stop('Generation stopped when the page was left. Run again to continue.'));
exampleSelect.value = EXAMPLES[0].id;
loadExample(EXAMPLES[0].id);
runFixture();
