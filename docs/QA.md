# Testing and verification

FixtureLang includes executable tests for its language, exports, local tooling and browser interactions. The checks below describe a verification snapshot from 2026-10-26, not a security certification or a promise of compatibility with every browser or spreadsheet application.

## Recorded results

| Command or check | Result |
| --- | --- |
| `npm test` | 39 tests passed; no failures or skips |
| `npm run check` | 15 JavaScript files passed Node syntax checks and the configured architecture checks in the extracted source release |
| `npm run build` | Static distribution generated successfully; source/distribution byte equality checked |
| `npm run test:browser` | 12 browser scenarios passed in Chromium 156.0.8078.4 |
| Browser page and console errors | None recorded during those scenarios |
| External browser requests | None recorded during those scenarios |

The project uses JavaScript. TypeScript and ESLint are not configured. `npm run check` performs the specific syntax and architecture checks in [scripts/check.mjs](../scripts/check.mjs); it is not a general-purpose type checker or linter.

## Reproduce the checks

Node.js 20 or newer is required. Runtime, unit tests, source checks and build use Node built-ins and need no third-party package installation:

```sh
npm test
npm run check
npm run build
```

The optional browser suite additionally needs a separately installed `playwright-core` package and its Chromium binary. `FIXTURELANG_PLAYWRIGHT` may point to the package when it is not resolvable by name:

```sh
npm run test:browser
```

The [browser harness](../scripts/browser-qa.mjs) starts a loopback server, exercises the actual worker, saves downloaded output and screenshots under `evidence/`, and writes `evidence/browser-results.json`. It records browser errors and blocks and records requests outside that local origin. Its browser context is isolated from an ordinary browser profile. The browser package is development tooling, not an application runtime dependency.

## Language and export coverage

The [test suite](../tests) checks:

- Deterministic generation across seeds, exact Mulberry32 samples and repeated byte-identical exports.
- Generator/type compatibility, inclusive ranges, safe-integer boundaries, strict Gregorian dates and valid Unicode strings.
- Syntax and semantic failures with positioned diagnostics, complete-source parsing and rejection of unsupported syntax.
- Missing/null distinctions, duplicate precedence and relations sampled from final eligible parent IDs.
- Source, token, literal, table, field, row, cell and generated-text budgets, plus cancellation and immutable compiled-AST admission.
- Object-special identifiers, raw CSV quoting and round trips, explicit spreadsheet-mode transformations and negative numeric cells.
- Executable example/source consistency, CLI behavior and local server behavior.

Adversarial/property cases include 1,000 source mutations; 360 mutation/reference combinations compared with a separate final-value oracle; 1,024 full-width integer draws near safe-integer extremes; and surrogate-pair literal boundaries. These cases increase coverage but do not exhaust the input space.

All four examples executed within their declared budgets:

| Example | Rows | Declared field cells |
| --- | ---: | ---: |
| Importer edge cases | 30 | 132 |
| Related orders | 18 | 78 |
| CSV boundaries | 16 | 112 |
| Bounded workload | 20,000 | 200,000 |

## Browser coverage

The 12 scenarios cover:

1. Real worker generation, distinct missing/null markers and desktop layout at 1440px width.
2. JSON downloads matching interpreter output and byte-identical exports after repeated runs.
3. Table selection, JSON preview and arrow-key tab navigation/focus.
4. Edit invalidation, keyboard run, exact diagnostic location and a working focus jump.
5. Explicit CSV mode selection and real raw/spreadsheet download differences.
6. Source download preserving the current edited text.
7. Reduced-motion behavior and cancellation that prevents late result admission.
8. A completed 20,000-row run, bounded previews and a full JSON download.
9. Editing during generation and usable Run controls after pagehide/history restoration.
10. Editable source, working run/export controls and no page-level horizontal overflow at 390px and 320px widths.
11. Keyboard skip link, visible focus and documentation routes.
12. Page/console errors and external requests.

## Verification limits

The recorded browser run covers Chromium, not a complete cross-browser matrix. Automated focus and layout checks do not replace a full assistive-technology audit. CSV protection was checked as an explicit string transformation; the output was not executed in every spreadsheet application. The suite does not prove parser correctness, conduct a multiday fuzz campaign, or establish a human security audit. See [credits](credits.md) for development provenance and [limitations](limitations.md) for the supported language scope.

