# FixtureLang

A small deterministic language for test fixtures, with a working local playground. Write typed tables, connect them, and deliberately generate missing values, nulls or duplicate IDs to test an importer. The fixture source is the reproducible test case.

This is a local prototype for Syntax Summit. It includes a real lexer/parser, semantic validation and bounded interpreter. At runtime it needs no external AI service, database, account or network connection.

## Run locally

Requires Node.js 20 or newer. No dependency installation is needed.

```sh
npm start
```

Open the loopback URL printed by the server. Keep that process running while using the playground. Source is processed in a Web Worker; Cancel terminates the active worker. Ctrl+Enter or Cmd+Enter runs the editor. Each run starts fresh from the declared seed. Downloads are local browser downloads.

```sh
npm test
npm run check
npm run build
```

`test` runs the automated language, export and tooling suite. `check` runs Node syntax and targeted architecture checks. `build` creates the static distribution; `npm run preview` serves it locally. See [testing and verification](docs/QA.md) for recorded results and coverage.

The optional `npm run test:browser` suite requires a separately installed `playwright-core` package and Chromium. If needed, point `FIXTURELANG_PLAYWRIGHT` to that package's path. This is development-only tooling; the application itself has no third-party runtime dependencies.

To generate output without the playground, use the local CLI. CSV requires both a selected table and an explicit export mode:

```sh
npm run fixture -- examples/importer-edges.fixture --json
npm run fixture -- examples/csv-boundaries.fixture --csv payloads --mode raw
npm run fixture -- examples/csv-boundaries.fixture --csv payloads --mode spreadsheet
```

The CLI writes data to standard output and diagnostics to standard error. To pipe data without npm's script banner, invoke `node scripts/cli.mjs` with the same arguments. Ctrl+C requests cancellation during generation; cancelled generation produces no dataset output.

## A complete fixture

```fixture
fixture shop seed 42 {
  table customers rows 3 {
    id: id = seq(1) duplicate every 3;
    name: string = text("Customer ");
    email: string = pick("ada@example.test", "lin@example.test") missing every 2;
  }
  table orders rows 5 {
    id: id = seq(100);
    customer_id: id = ref(customers.id);
    total_cents: int = int(0, 9999);
    note: string = pick("new", "rush") null every 3;
  }
}
```

`missing every 2` omits the property on rows 2, 4, 6, …; `null every 3` writes JSON `null`. `duplicate every 3` copies the preceding final ID on rows 3, 6, 9, … . Relations draw from the actual remaining parent IDs, so these intentionally damaged tables remain useful together. An `id` is an integer-valued relation type; uniqueness is not an implicit constraint.

The playground includes [importer edges](examples/importer-edges.fixture), [related orders](examples/related-orders.fixture), [CSV boundaries](examples/csv-boundaries.fixture) and a [bounded workload](examples/bounded-workload.fixture). Each is executable source, mirrored in the example picker.

## Exports and limits

JSON retains omitted properties, explicit nulls and empty strings. CSV cannot distinguish those three states: all become empty cells. Choose JSON if your importer needs that distinction.

CSV export requires an explicit choice. **Raw test payload** preserves strings exactly, including formula-like text. **Spreadsheet-safe** prefixes an apostrophe to strings that could be interpreted as formulas, plus strings beginning with tab, CR or LF. This intentionally changes those cells and reports the count; it is a spreadsheet-use convenience, not a byte-identical test payload or a universal spreadsheet security guarantee. Negative numeric values remain numeric. Quoting still follows CSV syntax in both modes.

Fixed budgets cap source, tokens, rows, tables, fields, generated cells and text. The UI previews at most 100 rows per table; the download contains the entire completed dataset. Parsing failures include a line and column. No loops, imports, arbitrary expressions, eval, file access or source-selected network requests exist in the language.

## Documentation

- [Language reference and grammar](docs/language-reference.md)
- [Implementation and safety model](docs/implementation.md)
- [Four-minute demo outline](docs/demo-outline.md)
- [Honest limitations](docs/limitations.md)
- [Testing and verification](docs/QA.md)
- [Credits and development provenance](docs/credits.md)

FixtureLang was developed with OpenAI Codex assistance. The application runs locally without a remote model or API; see [credits](docs/credits.md) for provenance.
