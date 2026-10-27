# Implementation and safety model

FixtureLang is deliberately finite. It describes tables and field generators; it cannot express loops, recursion, arbitrary arithmetic, user functions, imports or I/O. Untrusted source is data for a lexer and parser, never JavaScript source for `eval`, `Function`, a module loader or a shell.

## Pipeline

1. A bounded lexer turns source into positioned tokens. JSON strings are decoded and validated; malformed escapes and invalid Unicode scalars fail with a diagnostic.
2. A recursive-descent parser constructs a program AST using the small grammar. Syntax must consume the complete source.
3. A semantic checker validates generator/type pairs, names, integer/date ranges, modifier combinations, resource budgets and earlier-table references.
4. The interpreter creates each table in row/field order from the declared seed, then applies explicit mutations. It checks cancellation and periodically yields control.
5. The browser worker posts a completed dataset or structured diagnostic. Run creates a fresh worker; Cancel terminates it. Run identity guards prevent stale results from replacing newer results.
6. Export functions serialize a completed dataset. JSON retains missing/null distinctions; CSV requires an explicit raw or spreadsheet transformation choice.

The library exposes `compile(source)`, `execute(program, {signal, onProgress})`, and the convenience `run(source, options)`. Failures use `FixtureError`, which carries `.diagnostic = {code, message, line, column}`. `LIMITS` exposes the fixed public budgets. Compilation deeply freezes its AST and admits it through a module-private registry; `execute` rejects clones or objects that did not come from that module's `compile`. The untrusted-input boundary is the source string.

## Bounds and cancellation

Source, lexical tokens, tables, fields, row counts, cell counts, literals and generated text are bounded. These limits are fixed in the implementation rather than configurable by source. A finite grammar avoids expression nesting and parser recursion driven by arbitrary input. Every generator performs bounded work. Reference pools are formed from completed parent output rather than repeatedly searching all parent rows for each child row.

The asynchronous interpreter yields at least once per 128 generated rows and checks an optional `AbortSignal`. A browser worker keeps parsing and generation away from the main UI thread; termination provides immediate cancellation even before the interpreter's next cooperative checkpoint. Export and previews work only with a complete result, so cancellation does not expose partially generated fixtures.

## Data integrity

Field and table names are preserved safely, including object-special names such as `__proto__` and `constructor`. Rows use safe own-property construction. Source and generated values are rendered as text; neither is interpolated as HTML.

Randomness comes solely from the explicit seed. Dates use UTC day arithmetic with strict Gregorian validation. Export strings do not include wall-clock timestamps. Mutation draws are still consumed, avoiding accidental changes to later random values solely because a field was omitted after generation.

Raw exports preserve intentional fault strings. Spreadsheet mode is a separate explicit transformation with a count of changed cells. No protection is silently applied to raw test cases. Both modes quote and escape CSV syntax. Spreadsheet-mode protection is a limited convenience for formula-like strings, not a general assurance for every spreadsheet program and downstream workflow.

## Local operation

The application uses native ES modules, local styles and system fonts. No service worker, remote asset, analytics, remote model or external API is required. Serve the project over the included loopback HTTP server; opening `index.html` directly from a file URL is not the supported worker/module setup. Downloads are generated in the browser from completed data.

The developer server is for a single local user. Keep its loopback bind. Production hosting requires a separate static-hosting configuration; the developer server supplies neither authentication nor an upload service.

See [the reference](language-reference.md) for exact budgets and [limitations](limitations.md) for intentionally excluded features.
