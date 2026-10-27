/** FixtureLang 0.1: bounded lexer, recursive-descent parser and deterministic interpreter. */
export const LIMITS = Object.freeze({
  sourceUnits: 65_536,
  tokens: 20_000,
  identifierUnits: 64,
  literalUnits: 256,
  tables: 8,
  fieldsPerTable: 32,
  rowsPerTable: 10_000,
  totalRows: 20_000,
  cells: 200_000,
  pickChoices: 32,
  stringUnits: 8_000_000,
  yieldRows: 128,
});

export class FixtureError extends Error {
  constructor(code, message, location = { line: 1, column: 1 }) {
    super(message);
    this.name = 'FixtureError';
    this.diagnostic = Object.freeze({ code, message, line: location.line, column: location.column });
  }
}

const fail = (code, message, location) => { throw new FixtureError(code, message, location); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const compiledPrograms = new WeakSet();
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
const isIdentStart = (c) => c !== undefined && /[A-Za-z_]/.test(c);
const isIdentPart = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);

function hasUnpairedSurrogate(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function tokenize(source) {
  if (typeof source !== 'string') fail('SYNTAX', 'Source must be a string.');
  if (source.length > LIMITS.sourceUnits) fail('LIMIT', `Source exceeds ${LIMITS.sourceUnits} UTF-16 units.`);
  let offset = 0;
  let line = 1;
  let column = 1;
  let previousCR = false;
  const tokens = [];
  const advance = () => {
    const char = source[offset++];
    if (char === '\r') { line += 1; column = 1; previousCR = true; }
    else if (char === '\n') { if (!previousCR) line += 1; column = 1; previousCR = false; }
    else { column += 1; previousCR = false; }
    return char;
  };
  const push = (kind, value, location) => {
    if (tokens.length >= LIMITS.tokens) fail('LIMIT', `Source exceeds ${LIMITS.tokens} tokens.`, location);
    tokens.push({ kind, value, ...location });
  };
  while (offset < source.length) {
    const char = source[offset];
    if (/\s/.test(char)) { advance(); continue; }
    if (char === '#') { while (offset < source.length && !/[\r\n]/.test(source[offset])) advance(); continue; }
    const location = { line, column };
    if (isIdentStart(char)) {
      const start = offset;
      do { advance(); } while (isIdentPart(source[offset]));
      const value = source.slice(start, offset);
      if (value.length > LIMITS.identifierUnits) fail('LIMIT', `Identifier exceeds ${LIMITS.identifierUnits} characters.`, location);
      push('word', value, location);
    } else if (isDigit(char) || char === '-') {
      const start = offset;
      if (char === '-') advance();
      if (!isDigit(source[offset])) fail('SYNTAX', 'Expected a digit after minus sign.', location);
      do { advance(); } while (isDigit(source[offset]));
      const raw = source.slice(start, offset);
      if (!/^-?(0|[1-9][0-9]*)$/.test(raw) || raw === '-0') {
        fail('SYNTAX', 'Use decimal integers without leading zeros or negative zero.', location);
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) fail('CONSTRAINT', 'Integer must be within JavaScript safe integer bounds.', location);
      push('number', value, location);
    } else if (char === '"') {
      const start = offset;
      advance();
      let closed = false;
      while (offset < source.length) {
        const current = advance();
        if (current.charCodeAt(0) < 0x20) fail('SYNTAX', 'Control characters in strings must use JSON escapes.', location);
        if (current === '"') { closed = true; break; }
        if (current === '\\') {
          if (offset >= source.length) break;
          const escaped = advance();
          if (escaped.charCodeAt(0) < 0x20) fail('SYNTAX', 'Control characters in strings must use JSON escapes.', location);
        }
      }
      if (!closed) fail('SYNTAX', 'Unterminated string literal.', location);
      let value;
      try { value = JSON.parse(source.slice(start, offset)); }
      catch { fail('SYNTAX', 'Invalid JSON string escape.', location); }
      if (value.length > LIMITS.literalUnits) fail('LIMIT', `String literal exceeds ${LIMITS.literalUnits} UTF-16 units.`, location);
      if (hasUnpairedSurrogate(value)) fail('SYNTAX', 'String contains an unpaired Unicode surrogate.', location);
      push('string', value, location);
    } else if ('{}:=(),;.'.includes(char)) {
      advance();
      push('symbol', char, location);
    } else {
      fail('SYNTAX', `Unexpected character ${JSON.stringify(char)}.`, location);
    }
  }
  tokens.push({ kind: 'eof', value: '', line, column });
  return tokens;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }
  peek() { return this.tokens[this.index]; }
  take() { return this.tokens[this.index++]; }
  at(value) { return this.peek().value === value; }
  expect(value) {
    const token = this.peek();
    if (token.value !== value || token.kind === 'string') fail('SYNTAX', `Expected ${JSON.stringify(value)}, found ${this.describe(token)}.`, token);
    return this.take();
  }
  describe(token) { return token.kind === 'eof' ? 'end of source' : JSON.stringify(token.value); }
  word(label = 'identifier') {
    const token = this.peek();
    if (token.kind !== 'word') fail('SYNTAX', `Expected ${label}, found ${this.describe(token)}.`, token);
    return this.take();
  }
  number(unsigned = false) {
    const token = this.peek();
    if (token.kind !== 'number') fail('SYNTAX', 'Expected a decimal integer.', token);
    this.take();
    if (unsigned && token.value < 0) fail('CONSTRAINT', 'Expected a nonnegative integer.', token);
    return token;
  }
  string() {
    const token = this.peek();
    if (token.kind !== 'string') fail('SYNTAX', 'Expected a double-quoted string.', token);
    return this.take();
  }
  program() {
    const location = this.expect('fixture');
    const name = this.word().value;
    this.expect('seed');
    const seed = this.number(true);
    this.expect('{');
    const tables = [];
    while (!this.at('}') && this.peek().kind !== 'eof') {
      if (tables.length >= LIMITS.tables) fail('LIMIT', `At most ${LIMITS.tables} tables are allowed.`, this.peek());
      tables.push(this.table());
    }
    if (!tables.length) fail('SYNTAX', 'A fixture needs at least one table.', this.peek());
    this.expect('}');
    if (this.peek().kind !== 'eof') fail('SYNTAX', 'Unexpected input after fixture.', this.peek());
    return { kind: 'FixtureProgram', version: '0.1', name, seed: seed.value, seedLocation: seed, tables, location };
  }
  table() {
    const location = this.expect('table');
    const nameToken = this.word();
    this.expect('rows');
    const rowToken = this.number(true);
    this.expect('{');
    const fields = [];
    while (!this.at('}') && this.peek().kind !== 'eof') {
      if (fields.length >= LIMITS.fieldsPerTable) fail('LIMIT', `At most ${LIMITS.fieldsPerTable} fields per table are allowed.`, this.peek());
      fields.push(this.field());
    }
    if (!fields.length) fail('SYNTAX', 'A table needs at least one field.', this.peek());
    this.expect('}');
    return { name: nameToken.value, rows: rowToken.value, fields, location, nameLocation: nameToken, rowLocation: rowToken };
  }
  field() {
    const location = this.word('field name');
    this.expect(':');
    const type = this.word('field type');
    this.expect('=');
    const generator = this.generator();
    const modifiers = [];
    while (!this.at(';') && this.peek().kind !== 'eof') {
      const modifier = this.word('";" or a missing, null, or duplicate modifier');
      if (!['missing', 'null', 'duplicate'].includes(modifier.value)) fail('SYNTAX', `Unknown modifier ${JSON.stringify(modifier.value)}.`, modifier);
      this.expect('every');
      const interval = this.number(true);
      modifiers.push({ kind: modifier.value, every: interval.value, location: modifier, intervalLocation: interval });
      if (modifiers.length > 2) fail('CONSTRAINT', 'A field allows one missing/null modifier and one duplicate modifier.', modifier);
    }
    this.expect(';');
    return { name: location.value, type: type.value, generator, modifiers, location, typeLocation: type };
  }
  generator() {
    const location = this.word('generator');
    const kind = location.value;
    if (!['seq', 'int', 'bool', 'pick', 'text', 'date', 'ref'].includes(kind)) fail('SYNTAX', `Unknown generator ${JSON.stringify(kind)}.`, location);
    this.expect('(');
    const args = [];
    if (kind === 'seq' || kind === 'bool') args.push(this.number(kind === 'bool').value);
    else if (kind === 'int') { args.push(this.number().value); this.expect(','); args.push(this.number().value); }
    else if (kind === 'text') args.push(this.string().value);
    else if (kind === 'date') { args.push(this.string().value); this.expect(','); args.push(this.string().value); }
    else if (kind === 'ref') { args.push(this.word('table name').value); this.expect('.'); args.push(this.word('field name').value); }
    else {
      args.push(this.string().value);
      while (this.at(',')) {
        this.take();
        if (args.length >= LIMITS.pickChoices) fail('LIMIT', `pick allows at most ${LIMITS.pickChoices} choices.`, this.peek());
        args.push(this.string().value);
      }
    }
    this.expect(')');
    return { kind, args, location };
  }
}

const generatorTypes = Object.freeze({ id: ['seq', 'ref'], int: ['seq', 'int'], string: ['pick', 'text'], bool: ['bool'], date: ['date'] });

function isoDay(value, location) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('CONSTRAINT', 'Date must use YYYY-MM-DD.', location);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) {
    fail('CONSTRAINT', `Invalid Gregorian date ${JSON.stringify(value)}.`, location);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86_400_000;
}

function eligibleCount(field, count) {
  const duplicate = field.modifiers.find((modifier) => modifier.kind === 'duplicate');
  const omission = field.modifiers.find((modifier) => modifier.kind !== 'duplicate');
  let previousEligible = true;
  let eligible = 0;
  for (let row = 1; row <= count; row += 1) {
    let current = duplicate && row % duplicate.every === 0 ? previousEligible : true;
    if (omission && row % omission.every === 0) current = false;
    if (current) eligible += 1;
    previousEligible = current;
  }
  return eligible;
}

function validate(program) {
  if (program.seed > 0xffff_ffff) fail('CONSTRAINT', 'Seed must be an unsigned 32-bit integer (0..4294967295).', program.seedLocation);
  const earlierTables = new Map();
  let totalRows = 0;
  let cells = 0;
  for (const table of program.tables) {
    if (earlierTables.has(table.name)) fail('DUPLICATE', `Table ${JSON.stringify(table.name)} is declared twice.`, table.nameLocation);
    if (table.rows > LIMITS.rowsPerTable) fail('LIMIT', `A table may generate at most ${LIMITS.rowsPerTable} rows.`, table.rowLocation);
    totalRows += table.rows;
    cells += table.rows * table.fields.length;
    if (totalRows > LIMITS.totalRows) fail('LIMIT', `Fixture exceeds ${LIMITS.totalRows} total rows.`, table.rowLocation);
    if (cells > LIMITS.cells) fail('LIMIT', `Fixture exceeds ${LIMITS.cells} generated cells.`, table.rowLocation);
    const fields = new Map();
    for (const field of table.fields) {
      if (fields.has(field.name)) fail('DUPLICATE', `Field ${JSON.stringify(field.name)} is declared twice.`, field.location);
      fields.set(field.name, field);
      const { generator } = field;
      if (!own(generatorTypes, field.type)) fail('TYPE', `Unknown field type ${JSON.stringify(field.type)}.`, field.typeLocation);
      if (!generatorTypes[field.type].includes(generator.kind)) fail('TYPE', `${field.type} does not support ${generator.kind}().`, generator.location);
      let omission;
      let duplicate;
      for (const modifier of field.modifiers) {
        if (modifier.kind === 'duplicate') {
          if (duplicate) fail('CONSTRAINT', 'A field may have only one duplicate modifier.', modifier.location);
          duplicate = modifier;
          if (modifier.every < 2) fail('CONSTRAINT', 'duplicate every interval must be at least 2.', modifier.intervalLocation);
          if (field.type !== 'id' || generator.kind !== 'seq') fail('TYPE', 'duplicate is only allowed on id = seq(...).', modifier.location);
        } else {
          if (omission) fail('CONSTRAINT', 'missing and null are mutually exclusive and may appear only once.', modifier.location);
          omission = modifier;
          if (modifier.every < 1) fail('CONSTRAINT', 'missing/null every interval must be at least 1.', modifier.intervalLocation);
        }
      }
      const [first, second] = generator.args;
      if (generator.kind === 'seq' && table.rows > 0 && !Number.isSafeInteger(first + (table.rows - 1))) fail('CONSTRAINT', 'Sequence would overflow safe integer bounds.', generator.location);
      if (generator.kind === 'int' && (first > second || second - first + 1 > 0x1_0000_0000)) fail('CONSTRAINT', 'int requires min <= max and an inclusive width no greater than 4294967296.', generator.location);
      if (generator.kind === 'bool' && first > 100) fail('CONSTRAINT', 'bool probability must be an integer from 0 to 100.', generator.location);
      if (generator.kind === 'date') {
        generator.days = [isoDay(first, generator.location), isoDay(second, generator.location)];
        if (generator.days[0] > generator.days[1]) fail('CONSTRAINT', 'date start must be on or before end.', generator.location);
      }
      if (generator.kind === 'ref') {
        const target = earlierTables.get(first);
        if (!target) fail('REFERENCE', `ref target table ${JSON.stringify(first)} must be declared earlier.`, generator.location);
        const targetField = target.fields.get(second);
        if (!targetField || targetField.type !== 'id' || targetField.generator.kind !== 'seq') fail('REFERENCE', 'ref must target an id = seq(...) field in an earlier table.', generator.location);
        if (table.rows > 0 && eligibleCount(targetField, target.table.rows) === 0) fail('REFERENCE', 'ref target has no present, non-null values after mutations.', generator.location);
        generator.targetTable = program.tables.indexOf(target.table);
        generator.targetField = second;
      }
    }
    earlierTables.set(table.name, { table, fields });
  }
  program.totals = { rows: totalRows, cells };
  return program;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Compile source into an immutable AST; errors include 1-based UTF-16 coordinates. */
export function compile(source) {
  const program = deepFreeze(validate(new Parser(tokenize(source)).program()));
  compiledPrograms.add(program);
  return program;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = Math.imul(state ^ (state >>> 15), state | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

const yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Execute only a compiled AST. A worker can be terminated in addition to cooperative AbortSignal checks. */
export async function execute(program, { signal, onProgress } = {}) {
  if (!program || !compiledPrograms.has(program)) fail('CONSTRAINT', 'execute requires the unchanged AST returned by compile().');
  const checkCancelled = () => { if (signal?.aborted) fail('CANCELLED', 'Generation cancelled.'); };
  checkCancelled();
  const random = mulberry32(program.seed);
  const tables = [];
  const pools = new Map();
  let rows = 0;
  let cells = 0;
  let stringUnits = 0;
  const progress = () => onProgress?.({ rows, totalRows: program.totals.rows });
  progress();
  for (const table of program.tables) {
    const output = { name: table.name, fields: table.fields.map(({ name, type }) => ({ name, type })), rows: [] };
    for (let index = 0; index < table.rows; index += 1) {
      checkCancelled();
      const row = Object.create(null);
      for (const field of table.fields) {
        const { generator } = field;
        const [first, second] = generator.args;
        let value;
        let present = true;
        if (generator.kind === 'seq') value = first + index;
        else if (generator.kind === 'text') value = first + (index + 1);
        else {
          const draw = random();
          if (generator.kind === 'int') value = first + Math.floor(draw * (second - first + 1));
          else if (generator.kind === 'bool') value = draw * 100 < first;
          else if (generator.kind === 'pick') value = generator.args[Math.floor(draw * generator.args.length)];
          else if (generator.kind === 'date') {
            const [start, end] = generator.days;
            value = new Date((start + Math.floor(draw * (end - start + 1))) * 86_400_000).toISOString().slice(0, 10);
          } else {
            const key = `${generator.targetTable}:${generator.targetField}`;
            let pool = pools.get(key);
            if (!pool) {
              pool = tables[generator.targetTable].rows.filter((target) => own(target, generator.targetField) && target[generator.targetField] !== null).map((target) => target[generator.targetField]);
              pools.set(key, pool);
            }
            value = pool[Math.floor(draw * pool.length)];
          }
        }
        if (typeof value === 'string') {
          stringUnits += value.length;
          if (stringUnits > LIMITS.stringUnits) fail('LIMIT', `Generation exceeds ${LIMITS.stringUnits} string units.`, field.location);
        }
        const duplicate = field.modifiers.find((modifier) => modifier.kind === 'duplicate');
        if (duplicate && (index + 1) % duplicate.every === 0) {
          const previous = output.rows[index - 1];
          present = own(previous, field.name);
          value = previous[field.name];
        }
        const omission = field.modifiers.find((modifier) => modifier.kind !== 'duplicate');
        if (omission && (index + 1) % omission.every === 0) {
          if (omission.kind === 'missing') present = false;
          else { value = null; present = true; }
        }
        if (present) row[field.name] = value;
        cells += 1;
      }
      output.rows.push(row);
      rows += 1;
      if (rows % LIMITS.yieldRows === 0) {
        progress();
        await yieldTurn();
        checkCancelled();
      }
    }
    tables.push(output);
  }
  checkCancelled();
  progress();
  return { name: program.name, seed: program.seed, tables, stats: { rows, cells } };
}

export async function run(source, options) { return execute(compile(source), options); }
