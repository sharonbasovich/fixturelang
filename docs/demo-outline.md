# FixtureLang demo outline — approximately four minutes

Use the local playground and included examples for an approximately four-minute demonstration. Keep a competition submission cut under five minutes. This document is a recording outline.

| Time | Show | Say / demonstrate |
| --- | --- | --- |
| 0:00–0:25 | Importer edge cases source | “Importers fail on data that looks almost right. FixtureLang makes those cases reproducible: declare the tables, name the faults and keep the seed.” |
| 0:25–0:55 | Run, people table | Point to typed `id`, `string` and `bool` fields. Show duplicate IDs, the missing email marker and a distinct null nickname. These are intentional outputs. |
| 0:55–1:20 | Signups table and relation line | Show `ref(people.id)`. Explain earlier-table relations sample actual final parent IDs and retain duplicate weighting. Source defines a coherent test fixture. |
| 1:20–1:45 | Run twice, compare JSON | Keep seed 2026; run twice to show identical output. Change the seed to demonstrate changed random choices. Explain explicit seeds and a documented deterministic evaluation order. |
| 1:45–2:15 | Edit a generator/type mismatch | Change a string field to `int(1, 9)` and run. Show line/column feedback, focus the error and fix it. Explain real lexer, parser and semantic validation; no prompt, eval or remote model. |
| 2:15–2:55 | CSV boundaries, raw and spreadsheet modes | Run the example. Show comma/quote/newline handling and formula-like payloads. Switch explicitly between raw test strings and apostrophe-prefixed spreadsheet strings, with protected-cell count. Explain CSV collapses missing, null and empty; JSON preserves them. Download one CSV and JSON locally. |
| 2:55–3:20 | Bounded workload and Cancel | Run the 20,000-row example and cancel promptly. Show responsive controls. Explain fixed source/row/cell/text budgets, worker termination and no partial downloads. |
| 3:20–3:45 | Keyboard or narrow viewport, reference | Run with Ctrl/Cmd+Enter and show the stacked narrow layout. Point to the concise generator reference and documented grammar. |
| 3:45–4:10 | Tests and limitations | Show current test results and state what was verified. Close with the small-language scope: flat tables, earlier-table relations, no arbitrary code, local execution. |

## Recording preparation

Start the loopback server, reset the importer example, and close unrelated tabs. Increase the editor font or browser zoom enough for the recording. Keep source and output visible together. Rehearse cancellation once so the button press happens while generation is active. Use actual current counts and diagnostics; avoid scripted success claims unsupported by the screen.

If time runs over, shorten the intro and keyboard segment; preserve the language semantics, error handling and export distinction. A useful companion repository includes the parser/interpreter, executable examples, language reference and reproducible tests.
