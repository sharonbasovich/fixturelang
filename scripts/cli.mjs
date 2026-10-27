import { open } from 'node:fs/promises';
import { run, FixtureError } from '../src/language.js';
import { toCSV, toJSON } from '../src/export.js';

const USAGE = 'Usage: node scripts/cli.mjs FILE.fixture --json\n       node scripts/cli.mjs FILE.fixture --csv TABLE --mode raw|spreadsheet';
const arguments_ = process.argv.slice(2);
async function main() {
  const file = arguments_[0];
  const json = arguments_.length === 2 && arguments_[1] === '--json';
  const csv = arguments_.length === 5 && arguments_[1] === '--csv' && arguments_[3] === '--mode'
    && ['raw', 'spreadsheet'].includes(arguments_[4]);
  if (!file || !(json || csv)) throw new Error(USAGE);
  const handle = await open(file, 'r');
  let source;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Source must be a regular local file.');
    // A valid source is at most 64 Ki UTF-16 code units (at most 4 bytes per unit).
    if (metadata.size > 65536 * 4) throw new Error('Source file exceeds the 256 KiB read limit.');
    const maximum = 65536 * 4;
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length <= maximum) {
      const { bytesRead } = await handle.read(buffer, length, maximum + 1 - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new Error('Source file exceeds the 256 KiB read limit.');
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new Error('Source file must be valid UTF-8.'); }
  } finally { await handle.close(); }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    const dataset = await run(source, { signal: controller.signal });
    if (json) process.stdout.write(toJSON(dataset));
    else {
      const table = dataset.tables.find(item => item.name === arguments_[2]);
      if (!table) throw new Error(`Unknown table: ${arguments_[2]}`);
      const result = toCSV(table, { mode: arguments_[4] });
      process.stdout.write(result.text);
      if (result.missingCells || result.nullCells) {
        console.error(`CSV maps ${result.missingCells} missing and ${result.nullCells} null cells to empty cells. Use JSON to preserve the distinction.`);
      }
      if (result.protectedCells) console.error(`Spreadsheet mode prefixed ${result.protectedCells} cells with an apostrophe.`);
    }
  } finally { process.removeListener('SIGINT', cancel); }
}
main().catch(error => {
  if (error instanceof FixtureError) {
    const { code, line, column, message } = error.diagnostic;
    console.error(`${arguments_[0]}:${line}:${column} [${code}] ${message}`);
  } else console.error(error.message);
  process.exitCode = 1;
});
