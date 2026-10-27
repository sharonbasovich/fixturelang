# Credits and development provenance

FixtureLang is an original project implementation developed with assistance from **OpenAI Codex**. That assistance includes the language design and implementation, playground, tests, executable examples and documentation. Automated agent review contributed additional test cases and design checks. These activities are not represented as unaided human authorship or a human security audit.

The language is implemented by a lexer, recursive-descent parser, semantic validator and interpreter. AI assistance was used during development; running FixtureLang does not call a remote model, AI API or other external service.

## Existing techniques

- The deterministic PRNG implements the established **Mulberry32** algorithm. FixtureLang does not claim that algorithm as a new invention; its exact use and draw order are documented in the [language reference](language-reference.md).
- String literals use JSON escaping rules. The CSV exporter follows standard delimiter quoting and CRLF record conventions, with a separately selected formula-text transformation.
- The command-line interface, local server, build and ordinary tests use **Node.js built-in modules**.
- The application uses native browser ES modules and Web Workers. It has **no third-party runtime package dependency**.

## Visual assets and optional tooling

The playground uses CSS, text and the operating system's installed sans-serif and monospace fonts. It downloads no external fonts and bundles no stock photography, illustrations, music or other third-party media assets.

The optional browser test harness uses a separately installed **Playwright `playwright-core`** package and Chromium. Those tools are development dependencies supplied by the person running that optional suite; they are not vendored into, or required to run, the playground. Their respective project licenses and notices govern those tools.

See [testing and verification](QA.md) for the actual recorded check scope and its limitations.
