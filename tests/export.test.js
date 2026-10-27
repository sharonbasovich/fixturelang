import test from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, toJSON } from '../src/export.js';

const tableWith = (rows, names = ['value']) => ({
  name: 'sample', fields: names.map((name) => ({ name, type: 'string' })), rows,
});

// An independent strict-enough CSV reader for round-trip properties. It retains
// record boundaries inside quoted cells and checks CRLF record separators.
function readCSV(text) {
  const records = [];
  let record = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { record.push(cell); cell = ''; }
    else if (char === '\r' && text[i + 1] === '\n') {
      record.push(cell); records.push(record); record = []; cell = ''; i++;
    } else cell += char;
  }
  assert.equal(quoted, false, 'all CSV quotes closed');
  assert.equal(cell, '', 'CSV ends in CRLF');
  assert.equal(record.length, 0);
  return records;
}

test('CSV mode is mandatory and invalid choices are rejected', () => {
  const table = tableWith([{ value: '=1+1' }]);
  for (const options of [undefined, {}, { mode: 'auto' }, { mode: '' }, { mode: null }]) {
    assert.throws(() => toCSV(table, options), TypeError);
  }
});

test('raw CSV preserves commas, quotes, CR/LF, Unicode, whitespace and formulas', () => {
  const values = ['', 'a,b', 'a"b', 'a\r\nb', 'a\rb', 'a\nb', '  spaces  ', '雪☃️', '=SUM(1,2)', '\t=1+1', '\uFEFF@SUM(1)'];
  const table = tableWith(values.map((value) => ({ value })));
  const snapshot = JSON.stringify(table);
  const output = toCSV(table, { mode: 'raw' });
  assert.deepEqual(readCSV(output.text), [['value'], ...values.map((value) => [value])]);
  assert.equal(output.protectedCells, 0);
  assert.equal(output.missingCells, 0);
  assert.equal(output.nullCells, 0);
  assert.equal(JSON.stringify(table), snapshot, 'export does not mutate data');
});

test('spreadsheet mode protects dangerous text including Unicode-leading formulas', () => {
  const dangerous = ['=1', '+cmd', '-10', '@SUM(A1)', '\tplain', '\rplain', '\nplain', '  =1', '\u00A0+1', '\u2003-1', '\uFEFF@x'];
  const benign = ['hello', 'a=1', '  text', "'=1", '42', '雪'];
  const values = [...dangerous, ...benign];
  const output = toCSV(tableWith(values.map((value) => ({ value }))), { mode: 'spreadsheet' });
  assert.equal(output.protectedCells, dangerous.length);
  assert.deepEqual(readCSV(output.text).slice(1).flat(), [
    ...dangerous.map((value) => `'${value}`), ...benign,
  ]);
});

test('negative numeric values remain numeric while formula-like headers are protected', () => {
  const table = tableWith([{ '=header': -42 }, { '=header': '-42' }], ['=header']);
  const output = toCSV(table, { mode: 'spreadsheet' });
  assert.deepEqual(readCSV(output.text), [["'=header"], ['-42'], ["'-42"]]);
  assert.equal(output.protectedCells, 2);
});

test('CSV discloses missing/null collapse; empty strings and booleans serialize accurately', () => {
  const table = tableWith([{}, { value: null }, { value: '' }, { value: false }, { value: 0 }]);
  const output = toCSV(table, { mode: 'raw' });
  assert.deepEqual(readCSV(output.text), [['value'], [''], [''], [''], ['false'], ['0']]);
  assert.equal(output.missingCells, 1);
  assert.equal(output.nullCells, 1);
  assert.equal(toCSV(tableWith([]), { mode: 'raw' }).text, 'value\r\n');
});

test('CSV field order, own properties and adversarial names are retained', () => {
  const row = Object.fromEntries([['constructor', 'c'], ['__proto__', 'p']]);
  const table = tableWith([row, Object.create({ constructor: 'inherited' })], ['__proto__', 'constructor']);
  const output = toCSV(table, { mode: 'raw' });
  assert.deepEqual(readCSV(output.text), [['__proto__', 'constructor'], ['p', 'c'], ['', '']]);
  assert.equal(output.missingCells, 2);
  assert.equal({}.polluted, undefined);
});

test('JSON retains primitive types, missing vs null and prototype-looking table names', () => {
  const rows = [{ a: null, b: false, c: 42, d: '雪' }, {}];
  const dataset = { name: 'sample', seed: 0, tables: [{ name: '__proto__', rows }, { name: 'constructor', rows: [] }] };
  const text = toJSON(dataset);
  assert.ok(text.endsWith('\n'));
  assert.ok(text.includes('\n  "fixture"'));
  const decoded = JSON.parse(text);
  assert.equal(decoded.fixture, 'sample');
  assert.equal(decoded.seed, 0);
  assert.deepEqual(decoded.tables.__proto__, rows);
  assert.deepEqual(decoded.tables.constructor, []);
  assert.equal(Object.hasOwn(decoded.tables.__proto__[1], 'a'), false);
  assert.equal(toJSON(dataset), text);
});

test('raw CSV round trips 300 generated edge strings without lossy normalization', () => {
  let state = 11;
  const alphabet = ['a', ',', '"', '\r', '\n', '\t', '\u00A0', '雪', '=', '+', '-', '@', ' ', '0', "'"];
  const values = [];
  for (let row = 0; row < 300; row++) {
    let value = '';
    for (let j = 0; j < row % 31; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      value += alphabet[state % alphabet.length];
    }
    values.push(value);
  }
  const output = toCSV(tableWith(values.map((value) => ({ value }))), { mode: 'raw' });
  assert.deepEqual(readCSV(output.text).slice(1).flat(), values);
});
