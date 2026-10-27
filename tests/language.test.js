import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { compile, execute, run, FixtureError, LIMITS } from '../src/language.js';
import { toCSV, toJSON } from '../src/export.js';
import { EXAMPLES } from '../src/examples.js';

const program = (fields = 'id: id = seq(1);', { rows = 4, seed = 1 } = {}) =>
  `fixture sample seed ${seed} { table things rows ${rows} { ${fields} } }`;

function diagnostic(source, expectedCode) {
  let failure;
  try { compile(source); } catch (error) { failure = error; }
  assert.ok(failure instanceof FixtureError, `expected FixtureError for ${source.slice(0, 120)}`);
  assert.ok(failure.diagnostic && typeof failure.diagnostic === 'object');
  const detail = failure.diagnostic;
  assert.ok(typeof detail.code === 'string' && detail.code.length > 0);
  assert.ok(typeof detail.message === 'string' && detail.message.length > 0);
  assert.ok(Number.isInteger(detail.line) && detail.line >= 1);
  assert.ok(Number.isInteger(detail.column) && detail.column >= 1);
  if (expectedCode) assert.equal(detail.code, expectedCode);
  return detail;
}

test('minimal source yields typed deterministic rows and metadata', async () => {
  const result = await run(program('id: id = seq(10); n: int = seq(-2); label: string = text("item-"); yes: bool = bool(100);'));
  assert.equal(result.name, 'sample');
  assert.equal(result.seed, 1);
  assert.equal(result.tables[0].name, 'things');
  assert.deepEqual(result.tables[0].fields.map(({ name, type }) => ({ name, type })), [
    { name: 'id', type: 'id' }, { name: 'n', type: 'int' }, { name: 'label', type: 'string' }, { name: 'yes', type: 'bool' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tables[0].rows)), [
    { id: 10, n: -2, label: 'item-1', yes: true },
    { id: 11, n: -1, label: 'item-2', yes: true },
    { id: 12, n: 0, label: 'item-3', yes: true },
    { id: 13, n: 1, label: 'item-4', yes: true },
  ]);
  assert.deepEqual(result.stats, { rows: 4, cells: 16 });
});

test('seed 1 has a stable documented Mulberry32 stream and declaration-order draws', async () => {
  const data = await run(program('n: int = int(0,99); b: bool = bool(50); s: string = pick("A","B","C"); d: date = date("2025-01-01","2025-01-10");', { rows: 1 }));
  assert.deepEqual(JSON.parse(JSON.stringify(data.tables[0].rows[0])), { n: 62, b: true, s: 'B', d: '2025-01-10' });
});

test('80 seeds repeat byte-for-byte JSON and CSV and preserve all generator bounds', async () => {
  const signatures = new Set();
  for (let seed = 0; seed < 80; seed++) {
    const source = program('id: id = seq(1); n: int = int(-100,100); b: bool = bool(37); s: string = pick("","a,b","雪"); d: date = date("2024-02-28","2024-03-01");', { seed, rows: 20 });
    const first = await run(source);
    const second = await run(source);
    assert.equal(toJSON(first), toJSON(second));
    assert.equal(toCSV(first.tables[0], { mode: 'raw' }).text, toCSV(second.tables[0], { mode: 'raw' }).text);
    signatures.add(toJSON(first));
    for (const row of first.tables[0].rows) {
      assert.ok(Number.isInteger(row.n) && row.n >= -100 && row.n <= 100);
      assert.equal(typeof row.b, 'boolean');
      assert.ok(['', 'a,b', '雪'].includes(row.s));
      assert.ok(['2024-02-28', '2024-02-29', '2024-03-01'].includes(row.d));
    }
  }
  assert.equal(signatures.size, 80, 'different seeds change generated samples');
});

test('comments, contextual keywords, whitespace and JSON string escapes parse', async () => {
  const source = '# leading\r\nfixture fixture seed 0 {\r\n table table rows 1 { # tail\n seed: string = pick("a\\n\\t\\r\\\"\\\\\\u96ea"); } } # end';
  const result = await run(source);
  assert.equal(result.tables[0].rows[0].seed, 'a\n\t\r"\\雪');
});

test('missing omits JSON keys while null and empty strings remain explicit', async () => {
  const data = await run(program('id: id = seq(1); a: string = pick("") missing every 2; b: int = seq(0) null every 3;'));
  const rows = data.tables[0].rows;
  assert.equal(rows[0].a, '');
  assert.equal(Object.hasOwn(rows[1], 'a'), false);
  assert.equal(rows[2].b, null);
  assert.equal(Object.hasOwn(rows[2], 'b'), true);
  const json = JSON.parse(toJSON(data));
  assert.equal(Object.hasOwn(json.tables.things[1], 'a'), false);
  assert.equal(json.tables.things[2].b, null);
});

test('duplicate mutation copies previous final ID; mutations have fixed precedence', async () => {
  const first = await run(program('id: id = seq(10) duplicate every 2 missing every 3;', { rows: 6 }));
  const second = await run(program('id: id = seq(10) missing every 3 duplicate every 2;', { rows: 6 }));
  assert.deepEqual(first, second);
  assert.deepEqual(first.tables[0].rows.map((row) => Object.hasOwn(row, 'id') ? row.id : 'missing'), [10, 10, 'missing', 'missing', 14, 'missing']);
  const nullable = await run(program('id: id = seq(10) null every 3 duplicate every 2;', { rows: 5 }));
  assert.deepEqual(nullable.tables[0].rows.map((row) => row.id), [10, 10, null, null, 14]);
});

test('missing/null mutations still consume their generator random draw', async () => {
  const base = await run(program('a: int = int(0,100); b: int = int(0,100);'));
  const mutated = await run(program('a: int = int(0,100) missing every 1; b: int = int(0,100);'));
  assert.deepEqual(base.tables[0].rows.map((row) => row.b), mutated.tables[0].rows.map((row) => row.b));
  const boolSource = program('a: bool = bool(0); b: int = int(0,100);', { rows: 1 });
  assert.equal((await run(boolSource)).tables[0].rows[0].b, 0, 'bool(0) consumes seed-1 first draw');
});

test('relations select actual eligible final IDs and are deterministic across seeds', async () => {
  for (let seed = 0; seed < 30; seed++) {
    const source = `fixture rel seed ${seed} {
      table users rows 9 { id: id = seq(1) duplicate every 2 missing every 3; }
      table orders rows 30 { id: id = seq(100); user: id = ref(users.id); }
    }`;
    const data = await run(source);
    const valid = new Set(data.tables[0].rows.filter((row) => Object.hasOwn(row, 'id') && row.id !== null).map((row) => row.id));
    assert.ok(valid.size > 0);
    for (const row of data.tables[1].rows) assert.ok(valid.has(row.user));
    assert.equal(toJSON(await run(source)), toJSON(data));
  }
});

test('relations are weighted by rows, including duplicate target IDs', async () => {
  const source = `fixture weighted seed 1 {
    table a rows 4 { id: id = seq(1) duplicate every 2; }
    table b rows 4 { foreign: id = ref(a.id); }
  }`;
  const rows = (await run(source)).tables[1].rows;
  assert.deepEqual(rows.map((row) => row.foreign), [3, 1, 3, 3]);
});

test('zero-row tables produce headers and zero-row references need no target values', async () => {
  const source = 'fixture empty seed 0 { table a rows 0 { id: id = seq(1); } table b rows 0 { foreign: id = ref(a.id); } }';
  const data = await run(source);
  assert.deepEqual(data.tables.map((table) => table.rows.length), [0, 0]);
  assert.equal(toCSV(data.tables[0], { mode: 'raw' }).text, 'id\r\n');
});

test('prototype-looking names stay ordinary own data without polluting prototypes', async () => {
  const source = 'fixture constructor seed 0 { table __proto__ rows 2 { __proto__: id = seq(1); constructor: string = text("x"); } table constructor rows 1 { foreign: id = ref(__proto__.__proto__); } }';
  const data = await run(source);
  assert.equal(Object.hasOwn(data.tables[0].rows[0], '__proto__'), true);
  assert.equal(data.tables[0].rows[0].__proto__, 1);
  assert.equal(data.tables[0].rows[0].constructor, 'x1');
  assert.equal({}.polluted, undefined);
  assert.equal(JSON.parse(toJSON(data)).tables.__proto__[0].__proto__, 1);
});

test('strict Gregorian dates support leap days and years 0001 through 9999', async () => {
  for (const date of ['0001-01-01', '0099-12-31', '1600-02-29', '2000-02-29', '2024-02-29', '9999-12-31']) {
    const data = await run(program(`d: date = date("${date}","${date}");`, { rows: 2 }));
    assert.deepEqual(data.tables[0].rows.map((row) => row.d), [date, date]);
  }
  for (const date of ['0000-01-01', '1900-02-29', '2023-02-29', '2024-04-31', '2024-13-01', '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z']) {
    diagnostic(program(`d: date = date("${date}","${date}");`));
  }
  diagnostic(program('d: date = date("2025-02-01","2025-01-01");'));
});

test('numeric boundaries accept safe endpoints and maximum uint32 seed', async () => {
  const data = await run(program('lo: int = int(-9007199254740991,-9007199254740991); hi: id = seq(9007199254740991); full: int = int(0,4294967295);', { rows: 1, seed: 4294967295 }));
  assert.equal(data.tables[0].rows[0].lo, Number.MIN_SAFE_INTEGER);
  assert.equal(data.tables[0].rows[0].hi, Number.MAX_SAFE_INTEGER);
  assert.ok(data.tables[0].rows[0].full >= 0 && data.tables[0].rows[0].full <= 4294967295);
  for (const seed of ['-1', '4294967296', '01', '1e2', '1.5', '-0']) diagnostic(program(undefined, { seed }));
  for (const value of ['9007199254740992', '-9007199254740992', '01', '-01', '-0', '1e3', '1.1']) diagnostic(program(`n: int = seq(${value});`));
  diagnostic(program('n: int = seq(9007199254740991);', { rows: 2 }));
  diagnostic(program('n: int = int(0,4294967296);'));
  diagnostic(program('n: int = int(4,3);'));
});

test('all type mismatches, invalid generators, duplicate names and modifiers reject', () => {
  for (const fields of [
    'x: int = text("x");', 'x: bool = int(0,1);', 'x: string = seq(1);',
    'x: date = pick("2025-01-01");', 'x: id = int(1,2);', 'x: decimal = int(1,2);',
    'x: int = unknown(1);', 'x: string = pick();', 'x: string = pick(1);',
    'x: bool = bool(101);', 'x: bool = bool(-1);',
    'x: id = seq(1) duplicate every 1;', 'x: int = seq(1) duplicate every 2;',
    'x: id = seq(1) missing every 0;', 'x: int = seq(1) null every 0;',
    'x: id = seq(1) missing every 2 null every 3;',
    'x: id = seq(1) missing every 2 missing every 3;',
    'x: id = seq(1) duplicate every 2 duplicate every 3;',
    'x: int = seq(1); x: int = seq(2);',
  ]) diagnostic(program(fields));
  diagnostic('fixture p seed 0 { table x rows 1 { id: id = seq(1); } table x rows 1 { id: id = seq(1); } }', 'DUPLICATE');
});

test('relations reject forward, unknown, non-ID, transitive and empty eligible targets', () => {
  for (const source of [
    'fixture r seed 1 { table a rows 1 { f: id = ref(b.id); } table b rows 1 { id: id = seq(1); } }',
    'fixture r seed 1 { table a rows 1 { id: id = seq(1); } table b rows 1 { f: id = ref(a.missing); } }',
    'fixture r seed 1 { table a rows 1 { id: int = seq(1); } table b rows 1 { f: id = ref(a.id); } }',
    'fixture r seed 1 { table a rows 0 { id: id = seq(1); } table b rows 1 { f: id = ref(a.id); } }',
    'fixture r seed 1 { table a rows 4 { id: id = seq(1) missing every 1; } table b rows 1 { f: id = ref(a.id); } }',
    'fixture r seed 1 { table a rows 4 { id: id = seq(1) null every 1; } table b rows 1 { f: id = ref(a.id); } }',
    'fixture r seed 1 { table a rows 1 { id: id = seq(1); } table b rows 1 { f: id = ref(a.id); } table c rows 1 { f: id = ref(b.f); } }',
  ]) diagnostic(source, 'REFERENCE');
  diagnostic('fixture r seed 1 { table a rows 1 { id: id = seq(1); } table b rows 1 { f: int = ref(a.id); } }', 'TYPE');
});

test('syntax diagnostics locate unexpected characters, incomplete source and trailing text', () => {
  const detail = diagnostic('fixture p seed 1 {\n  table t rows 1 {\n    id: id = seq(1);\n    $\n  }\n}', 'SYNTAX');
  assert.equal(detail.line, 4);
  assert.equal(detail.column, 5);
  for (const source of ['', 'fixture p seed 0 {}', 'fixture p seed 0 { table t rows 1 {} }', 'fixture p seed 0 {', program() + ' garbage', program('id: id = seq(1)'), program('id: id = seq((1));'), program('x: string = pick("unterminated);')]) diagnostic(source, 'SYNTAX');
  const eof = diagnostic('fixture p seed 0 {\r\n  table t rows 1 {\r\n', 'SYNTAX');
  assert.equal(eof.line, 3);
  assert.equal(eof.column, 1);
});

test('JSON strings reject invalid escapes, controls and isolated UTF-16 surrogates', async () => {
  for (const literal of ['"\\x41"', '"\\uZZZZ"', '"raw\nline"', '"raw\tchar"', '"\\uD800"', '"\\uDC00"', '"\uD800"', '"\uDC00"']) diagnostic(program(`s: string = pick(${literal});`), 'SYNTAX');
  const valid = await run(program('s: string = pick("\\uD83D\\uDE00");', { rows: 1 }));
  assert.equal(valid.tables[0].rows[0].s, '😀');
});

test('resource limits reject source, identifiers, literal sizes, choices, rows, tables and cells', () => {
  assert.ok(Object.isFrozen(LIMITS), 'public limits cannot be changed');
  diagnostic('#' + 'x'.repeat(65536), 'LIMIT');
  diagnostic(program(`${'x'.repeat(65)}: int = seq(1);`), 'LIMIT');
  diagnostic(program(`s: string = pick("${'a'.repeat(257)}");`), 'LIMIT');
  diagnostic(program(`s: string = pick(${Array(33).fill('"a"').join(',')});`), 'LIMIT');
  diagnostic(program(undefined, { rows: 10001 }), 'LIMIT');
  diagnostic(program(Array.from({ length: 33 }, (_, index) => `x${index}: int = seq(1);`).join(' ')), 'LIMIT');
  diagnostic('fixture big seed 0 {' + Array.from({ length: 9 }, (_, index) => `table t${index} rows 0 { id: id = seq(1); }`).join(' ') + '}', 'LIMIT');
  diagnostic('fixture big seed 0 {' + Array.from({ length: 3 }, (_, index) => `table t${index} rows 10000 { id: id = seq(1); }`).join(' ') + '}', 'LIMIT');
  diagnostic(program(Array.from({ length: 21 }, (_, index) => `x${index}: int = seq(1);`).join(' '), { rows: 10000 }), 'LIMIT');
  // The source-size bound also limits tokenization work; this syntax input
  // specifically forces >20,000 tokens while remaining <64KiB.
  diagnostic('fixture p seed 0 { table t rows 0 { ' + 'x: int = seq(1);'.repeat(2100) + '} }', 'LIMIT');
});

test('generated-string resource budget rejects a bounded but overlarge result', async () => {
  const fields = Array.from({ length: 4 }, (_, index) => `s${index}: string = text("${'x'.repeat(256)}");`).join(' ');
  await assert.rejects(run(program(fields, { rows: 10000 })), (error) => error instanceof FixtureError && error.diagnostic.code === 'LIMIT');
});

test('maximum bounded row and cell workloads execute and finish with exact stats', async () => {
  const fields = Array.from({ length: 20 }, (_, index) => `x${index}: int = seq(${index});`).join(' ');
  const data = await run(program(fields, { rows: 10000 }));
  assert.deepEqual(data.stats, { rows: 10000, cells: 200000 });
  assert.equal(data.tables[0].rows[9999].x19, 10018);
});

test('cancellation handles already aborted signals and cancellation while yielding', async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(run(program(), { signal: aborted.signal }), (error) => error instanceof FixtureError && error.diagnostic.code === 'CANCELLED');
  const controller = new AbortController();
  const pending = run(program('x: int = int(0,100);', { rows: 10000 }), { signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, (error) => error instanceof FixtureError && error.diagnostic.code === 'CANCELLED');
  const progress = [];
  await run(program(undefined, { rows: 300 }), { onProgress: (entry) => progress.push(entry) });
  assert.ok(progress.length >= 2, 'progress/yield occurs within every 128 rows');
});

test('compiled programs can run repeatedly and handcrafted or altered ASTs reject', async () => {
  const compiled = compile(program());
  assert.ok(Object.isFrozen(compiled));
  assert.deepEqual(await execute(compiled), await execute(compiled));
  assert.throws(() => { compiled.seed = 4; }, TypeError);
  await assert.rejects(execute({}), (error) => error instanceof FixtureError);
});

test('400 bounded malformed inputs fail with diagnostics instead of host exceptions', () => {
  let state = 7;
  const chars = 'abc{}:;(),.0123456789-"\\\n\t#$\uD800';
  for (let i = 0; i < 400; i++) {
    let source = '';
    for (let j = 0; j < 1 + i % 95; j++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      source += chars[state % chars.length];
    }
    diagnostic(source);
  }
});

test('every executable .fixture example compiles, runs and exports deterministically', async () => {
  const folder = new URL('../examples/', import.meta.url);
  const examples = (await readdir(folder)).filter((name) => name.endsWith('.fixture'));
  assert.ok(examples.length >= 3, 'documented executable examples are present');
  for (const name of examples) {
    const source = await readFile(new URL(name, folder), 'utf8');
    const builtIn = EXAMPLES.find((example) => `${example.id}.fixture` === name);
    assert.ok(builtIn, `${name} is available from the playground`);
    assert.equal(source.replaceAll('\r\n', '\n').trim(), builtIn.source.replaceAll('\r\n', '\n').trim(), `${name} mirrors the playground source`);
    const data = await run(source);
    assert.equal(toJSON(data), toJSON(await run(source)), name);
    for (const table of data.tables) {
      assert.ok(toCSV(table, { mode: 'raw' }).text.endsWith('\r\n'));
      assert.ok(toCSV(table, { mode: 'spreadsheet' }).text.endsWith('\r\n'));
    }
  }
  assert.equal(examples.length, EXAMPLES.length);
});
