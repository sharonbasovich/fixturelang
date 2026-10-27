import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTable } from '../src/inspect.js';
import { run } from '../src/language.js';
import { EXAMPLES } from '../src/examples.js';
import { toCSV, toJSON } from '../src/export.js';

test('first example inspection isolates actual repeated, missing, and null cells with original indexes', async () => {
  const data = await run(EXAMPLES[0].source);
  const result = inspectTable(data.tables[0]);
  assert.deepEqual(result.counts, { all: 12, duplicate: 3, missing: 3, null: 4 });
  assert.deepEqual(result.rows.filter(row => row.duplicate.length).map(row => row.index), [3, 7, 11]);
  assert.deepEqual(result.rows.filter(row => row.missing.length).map(row => row.index), [3, 7, 11]);
  assert.deepEqual(result.rows.filter(row => row.null.length).map(row => row.index), [2, 5, 8, 11]);
});

test('counts cells, returns matching records once, and treats missing/null/empty/zero distinctly', () => {
  const rows = [Object.freeze({ a: 0, b: 0, text: '' }), Object.freeze({ a: 0, b: 0, text: '' }), Object.freeze({ a: null, b: null }), Object.freeze({})];
  const table = Object.freeze({ fields: Object.freeze([{ name: 'a', type: 'id' }, { name: 'b', type: 'id' }, { name: 'text', type: 'string' }]), rows: Object.freeze(rows) });
  const result = inspectTable(table);
  assert.deepEqual(result.counts, { all: 4, duplicate: 2, missing: 4, null: 2 });
  assert.deepEqual(result.rows[1].duplicate, ['a', 'b']);
  assert.deepEqual(result.rows[2].missing, ['text']);
  assert.deepEqual(result.rows[2].null, ['a', 'b']);
  assert.equal(result.rows.filter(row => row.duplicate.length).length, 1);
});

test('repeated references are observed without confusing them with sequence mutations or string repetition', async () => {
  const data = await run('fixture refs seed 1 { table p rows 1 { id: id = seq(7); } table c rows 4 { id: id = seq(1); parent: id = ref(p.id); label: string = pick("same"); } }');
  const result = inspectTable(data.tables[1]);
  assert.equal(result.counts.duplicate, 3);
  assert.deepEqual(result.rows.slice(1).map(row => row.duplicate), [['parent'], ['parent'], ['parent']]);
  assert.deepEqual(inspectTable({ fields: [], rows: [] }), { counts: { all: 0, duplicate: 0, missing: 0, null: 0 }, rows: [] });
});

test('inspection across 80 seeds leaves deterministic JSON and both CSV modes byte-identical', async () => {
  for (let seed = 0; seed < 80; seed++) {
    const data = await run(EXAMPLES[0].source.replace('seed 2026', `seed ${seed}`));
    const json = toJSON(data);
    const raw = toCSV(data.tables[0], { mode: 'raw' }).text;
    const safe = toCSV(data.tables[0], { mode: 'spreadsheet' }).text;
    for (const table of data.tables) {
      const first = inspectTable(table);
      assert.deepEqual(inspectTable(table), first);
      for (const kind of ['duplicate', 'missing', 'null']) assert.equal(first.rows.reduce((sum, row) => sum + row[kind].length, 0), first.counts[kind]);
    }
    assert.equal(toJSON(data), json);
    assert.equal(toCSV(data.tables[0], { mode: 'raw' }).text, raw);
    assert.equal(toCSV(data.tables[0], { mode: 'spreadsheet' }).text, safe);
  }
});

test('maximum fixture inspection stays within row and cell budgets', async () => {
  const data = await run(EXAMPLES[3].source);
  for (const table of data.tables) {
    const result = inspectTable(table);
    assert.equal(result.rows.length, 10000);
    assert.equal(result.counts.all, 10000);
    assert.equal(result.rows.at(-1).index, 9999);
  }
});
