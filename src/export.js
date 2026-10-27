/** Deterministic exports. Raw fixtures are never changed during export. */

/** @param {{name:string,seed:number,tables:Array<{name:string,rows:object[]}>}} dataset */
export function toJSON(dataset) {
  // fromEntries creates ordinary own data properties even for "__proto__".
  return JSON.stringify({
    fixture: dataset.name,
    seed: dataset.seed,
    tables: Object.fromEntries(dataset.tables.map((table) => [table.name, table.rows])),
  }, null, 2) + '\n';
}

/** CSV quoting is separate from spreadsheet formula protection. */
function quoteCSV(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param {{fields:Array<{name:string,type:string}>,rows:object[]}} table
 * @param {{mode:'raw'|'spreadsheet'}} options Explicit choice is required.
 */
export function toCSV(table, options) {
  if (options?.mode !== 'raw' && options?.mode !== 'spreadsheet') {
    throw new TypeError('CSV export requires mode "raw" or "spreadsheet".');
  }
  let protectedCells = 0;
  let missingCells = 0;
  let nullCells = 0;
  const encode = (value) => {
    let cell = value;
    // CSV quotes do not prevent formula execution. The apostrophe deliberately
    // changes the payload, only in the explicitly selected spreadsheet mode.
    if (options.mode === 'spreadsheet' && typeof cell === 'string'
      && /^(?:[\t\r\n]|\s*[=+\-@])/u.test(cell)) {
      cell = `'${cell}`;
      protectedCells++;
    }
    return quoteCSV(cell);
  };
  const records = [table.fields.map(({ name }) => encode(name)).join(',')];
  for (const row of table.rows) {
    records.push(table.fields.map(({ name }) => {
      if (!Object.hasOwn(row, name)) {
        missingCells++;
        return '';
      }
      const value = row[name];
      if (value === null) {
        nullCells++;
        return '';
      }
      return encode(value);
    }).join(','));
  }
  return { text: records.join('\r\n') + '\r\n', protectedCells, missingCells, nullCells };
}
