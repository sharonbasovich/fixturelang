/** Read-only inspection of a bounded generated table. Counts are cells, except all. */
export function inspectTable(table) {
  const counts = { all: table.rows.length, duplicate: 0, missing: 0, null: 0 };
  const seen = table.fields.map(field => field.type === 'id' ? new Set() : null);
  const rows = table.rows.map((record, index) => {
    const findings = { index, duplicate: [], missing: [], null: [] };
    table.fields.forEach((field, fieldIndex) => {
      let kind;
      if (!Object.hasOwn(record, field.name)) kind = 'missing';
      else if (record[field.name] === null) kind = 'null';
      else if (seen[fieldIndex]) {
        if (seen[fieldIndex].has(record[field.name])) kind = 'duplicate';
        else seen[fieldIndex].add(record[field.name]);
      }
      if (kind) {
        findings[kind].push(field.name);
        counts[kind]++;
      }
    });
    return findings;
  });
  return { counts, rows };
}
