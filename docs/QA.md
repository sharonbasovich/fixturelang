# Testing and verification

FixtureLang includes executable tests for its language, exports, local tooling and browser interactions. The checks below describe a verification snapshot from 2026-10-27, not a security certification or a promise of compatibility with every browser or spreadsheet application.

## 0.1.2 candidate: CSV and CLI corrections

On November 6, 2026, the integrated private candidate passed 51 Node tests on Linux with Node.js 24.22.1, syntax/architecture checks, static build and the public-file allowlist audit. This combines the empty-record CSV correction and the separate regular-file CLI correction, preserving every test from both candidates. A new exact-byte regression failed on 0.1.1 and passed after the narrow CSV correction. Six actual CLI outputs, covering empty strings, missing keys and nulls in both modes, were independently parsed by Python's standard CSV reader, including with blank-line skipping. Each retained all three one-field records. Multi-column serialization, generation and JSON were unchanged.

The CLI rejects FIFO inputs without waiting for a writer on POSIX systems, including a tested path-replacement race. Regular-file symlinks remain supported. This is a local reliability improvement, not a security boundary or a universal filesystem timeout. Windows retains its existing open mode; the three POSIX-only test groups skip there. Windows, macOS and Node.js 20/22 behavior have not been validated for this candidate.

The browser harness now includes an additional preview/download regression for these cases, but that new group and the full browser suite have not yet run on this candidate. Native download, visual, Windows and hosted CI acceptance remain pending. The browser results below are historical 0.1.1 evidence, not validation of 0.1.2 or a published-release claim.

## Recorded results

| Command or check | Result |
| --- | --- |
| `npm test` | 44 tests passed; no failures or skips |
| `npm run check` | 17 JavaScript files passed Node syntax checks and the configured architecture checks |
| `npm run build` | Static distribution generated successfully; source/distribution byte equality checked |
| `npm run test:browser` | 17 browser scenarios passed in Chromium 156.0.8078.4 |
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

The 0.1.1 inspection pass adds five scenario groups: exact cell counts and matching records with original row numbers; full exports across filters/format switches; per-table scope and truthful empty results; stale/error/interrupted runs and filter resets; cases beyond the original preview, bounded maximum-fixture rendering, keyboard radio selection, narrow viewports and reduced motion. Automated checks also confirm explicit accessible marker text, a polite status region, and horizontal reveal of highlighted cells while row numbers remain pinned. These are DOM/focus checks, not a manual screen-reader audit.

A single desktop Chromium sample scanned the full 20,000-row/200,000-cell fixture in approximately 11 ms. The inspector caches each completed table and renders at most 100 matching records. This observation is not a cross-device benchmark or a guaranteed timing budget.

## Verification limits

The recorded browser run covers Chromium, not a complete cross-browser matrix. Automated focus and layout checks do not replace a full assistive-technology audit. CSV protection was checked as an explicit string transformation; the output was not executed in every spreadsheet application. The suite does not prove parser correctness, conduct a multiday fuzz campaign, or establish a human security audit. See [credits](credits.md) for development provenance and [limitations](limitations.md) for the supported language scope.



## Private cumulative source-preservation candidate — November 6, 2026

Adds protection for nonempty custom source: example replacement requires explicit confirmation, and a conditional beforeunload listener requests a best-effort exit warning. Exact built-in source or an empty editor removes the listener. Running, canceling, generating and requesting source/data downloads do not establish retention. No storage or network behavior was added.

The separate source-state unit tests cover all built-ins, invalid/comment-only/Unicode/whitespace work, repeated edits and exact reverts. An isolated jsdom 30.1.1 harness executes the actual app modules with simulated workers, dialog choices and downloads; it reproduced silent replacement in the prior integrated candidate and checks canceled/confirmed replacement, active-worker preservation, valid-result preservation, selection, download-warning retention, repeated transitions and stale worker results. Those simulations do not establish native dialog or download behavior.

The browser suite includes new example-replacement and actual reload Cancel/Leave cases, and existing intentional example replacements explicitly accept only the expected confirmation. These new browser cases have not run. Native/browser/visual/mobile/accessibility/download acceptance, Windows/macOS, Node 20/22 and hosted CI remain pending. The existing CSV/FIFO fixes and their prior evidence are preserved. Do not publish on the basis of these source checks alone.
