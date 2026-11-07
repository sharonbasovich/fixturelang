import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../src/examples.js';
import { sourceExample, needsSourceProtection } from '../src/source-state.js';

test('reproducible built-in sources and an empty editor need no protection', () => {
  assert.equal(needsSourceProtection(''), false);
  assert.equal(sourceExample(''), '');
  for (const example of EXAMPLES) {
    assert.equal(sourceExample(example.source), example.id);
    assert.equal(needsSourceProtection(example.source), false);
  }
});

test('all nonempty custom source is protected, including invalid and comment-only work', () => {
  for (const source of [' ', '# unfinished idea 🪴', 'fixture invalid', '\r\n',
    'fixture my_data seed 1 { table t rows 1 { id: id = seq(1); } }']) {
    assert.equal(needsSourceProtection(source), true);
    assert.equal(sourceExample(source), '');
  }
});

test('edits and exact reverts use source content rather than generated or downloaded state', () => {
  for (const example of EXAMPLES) {
    for (const edited of [example.source + '\n', example.source + '\n# note', example.source.replace('seed', 'SEED')]) {
      assert.equal(needsSourceProtection(edited), true);
      assert.equal(needsSourceProtection(example.source), false);
    }
  }
});
