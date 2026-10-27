import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, execute, run, FixtureError } from '../src/language.js';

const sourceWith = (fields, rows = 4, seed = 0) => `fixture review seed ${seed} { table records rows ${rows} { ${fields} } }`;

test('independent review: mutated valid programs never leak host exceptions', () => {
  const valid = 'fixture review seed 123 { table roots rows 5 { id: id = seq(-2) duplicate every 2 missing every 3; label: string = pick("a,b","line\\nvalue"); } table linked rows 8 { root: id = ref(roots.id); n: int = int(-4,7); } }';
  const inserts = ['\uD800', '#', '\\', '"', '}', '(', '-', '\n', ';', 'x', '0', ' ', '.', '\u2028'];
  for (let i = 0; i < 1000; i++) {
    const offset = (i * 97) % valid.length;
    const source = i % 3 === 0
      ? valid.slice(0, offset) + valid.slice(offset + 1)
      : valid.slice(0, offset) + inserts[i % inserts.length] + valid.slice(offset + (i % 3 === 1 ? 1 : 0));
    try { compile(source); }
    catch (error) {
      assert.ok(error instanceof FixtureError, `${i}: ${error?.stack}`);
      assert.ok(Number.isInteger(error.diagnostic.line) && error.diagnostic.line > 0);
      assert.ok(Number.isInteger(error.diagnostic.column) && error.diagnostic.column > 0);
    }
  }
});

test('independent review: reference validation agrees with final-value oracle for mutation combinations', async () => {
  for (const omission of ['missing', 'null']) {
    for (let duplicate = 2; duplicate <= 5; duplicate++) {
      for (let interval = 1; interval <= 5; interval++) {
        for (let count = 0; count <= 8; count++) {
          const expected = [];
          for (let row = 1; row <= count; row++) {
            let value = row % duplicate === 0 ? expected[row - 2] : row;
            if (row % interval === 0) value = omission === 'null' ? null : undefined;
            expected.push(value);
          }
          const eligible = expected.filter(value => value !== null && value !== undefined);
          const source = `fixture relations seed 17 { table roots rows ${count} { id: id = seq(1) duplicate every ${duplicate} ${omission} every ${interval}; } table child rows 3 { fk: id = ref(roots.id); } }`;
          if (!eligible.length) assert.throws(() => compile(source), error => error instanceof FixtureError && error.diagnostic.code === 'REFERENCE');
          else {
            const result = await run(source);
            assert.deepEqual(result.tables[0].rows.map(row => Object.hasOwn(row, 'id') ? row.id : undefined), expected);
            for (const row of result.tables[1].rows) assert.ok(eligible.includes(row.fk));
          }
        }
      }
    }
  }
});

test('independent review: large-magnitude integers remain safe and within inclusive bounds', async () => {
  for (const [min, max] of [
    [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 4294967295],
    [Number.MAX_SAFE_INTEGER - 4294967295, Number.MAX_SAFE_INTEGER],
    [-4294967295, 0], [0, 4294967295],
  ]) {
    for (const seed of [0, 1, 2147483648, 4294967295]) {
      const result = await run(sourceWith(`n: int = int(${min},${max});`, 64, seed));
      for (const row of result.tables[0].rows) assert.ok(Number.isSafeInteger(row.n) && row.n >= min && row.n <= max);
    }
  }
  assert.equal((await run(sourceWith('n: int = seq(-9007199254740991);', 2))).tables[0].rows[1].n, -9007199254740990);
});

test('independent review: compiled nested ASTs are immutable and cannot be forged', async () => {
  const compiled = compile(sourceWith('id: id = seq(1) duplicate every 2; label: string = pick("a","b");'));
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) visit(child);
  };
  visit(compiled);
  assert.throws(() => { compiled.tables[0].fields[0].modifiers[0].every = 1; }, TypeError);
  await assert.rejects(execute(structuredClone(compiled)), error => error instanceof FixtureError && error.diagnostic.code === 'CONSTRAINT');
  const clone = JSON.parse(JSON.stringify(compiled));
  clone.tables[0].rows = 1e12;
  await assert.rejects(execute(clone), error => error instanceof FixtureError && error.diagnostic.code === 'CONSTRAINT');
});

test('independent review: literal UTF-16 limit counts pairs, not Unicode code points', async () => {
  const accepted = '\u{1f600}'.repeat(128);
  const output = await run(sourceWith(`s: string = pick(${JSON.stringify(accepted)});`, 1));
  assert.equal(output.tables[0].rows[0].s, accepted);
  assert.throws(() => compile(sourceWith(`s: string = pick(${JSON.stringify(accepted + 'x')});`)), error => error instanceof FixtureError && error.diagnostic.code === 'LIMIT');
});
