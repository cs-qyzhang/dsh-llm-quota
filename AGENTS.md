# AGENTS.md

## Project Overview

dsh-llm-quota is a DeepSeek Harness (dsh) plugin that shows the current model provider's remaining balance or Coding Plan quota in the status line, model menu, and "Current Model" label, with historical trends. Package name `@cs-qyzhang/dsh-llm-quota`, ESM, published to npm.

## Common Commands

```bash
npm run check   # Syntax check for all source files
npm test        # Automated regression tests (no real provider requests)
```

Run `npm install` in this directory before local `link:` development; regular npm installs are unaffected.

## File Structure

| File | Responsibility |
| --- | --- |
| `index.js` | Host plugin entry: routes, cache, history collection lifecycle, error normalization |
| `client.js` | Client plugin: locale registration, slot registration, polling, popup and view engine; must be a single-file classic script (injected directly via `<script src>`, no ES modules) |
| `history.js` | History metric extraction, deduplication, SQLite persistence (Node built-in `node:sqlite`) |
| `provider.js` | Public API re-exports for third-party module imports |
| `providers/` | Per-provider adapters (`kind`, `hosts`, `route`, `read`, `view`, `present`); shared utilities in `runtime.js` / `registry.js` / `resolve.js` / `shared.js` |
| `locale/*.json` | UI message dictionaries covering all languages dsh supports (en, zh, ja, es, fr, de, ru, pt) |
| `test/` | Regression tests mirroring the source files |

## Hard Constraints

- `client.js` contains no provider-specific code; provider details live entirely in `providers/`. The browser artifact must be a single-file classic script with no third-party dependencies and no bundled React.
- Host/Client boundary: secrets only pass through the Host; the Client receives only plain-data ViewModels. Manifests and responses never contain credential values.
- New shared message keys must be added to all 8 locale files with consistent key sets and placeholders across languages (`test/locale.test.js` enforces this).
- Provider API or display field changes only touch the corresponding provider's `read/view/present`; only change the shared core when adding a new preset or Client interaction.
- Styles use only `--dsw-alias-*`, `--dsw-specific-*`, and `--dsh-*` theme variables; never hard-code colors.
- Target environment: Node `>=22.13.0`; the supported dsh range lives only in `package.json` `engines`. Host config reading must support both `fiber.effectiveConfig` and legacy `fiber.config`.
- Run `npm run check` and `npm test` after changes; both must pass before the work is considered done.

## Documentation and Comment Writing Rules

- Describe only the current state: docs and comments reflect what the code "is and how to use it now", not what it "used to be or how it used to fail".
- Never include history: no pre-fix bugs, old-version error messages, or failure narratives; history belongs in git commit messages, not code comments or docs.
- No defensive explanations: avoid "this prevents...", "otherwise ... would happen" argumentation; state exceptions as a single constraint without consequences.
- Never copy concrete error text into docs unless the doc is itself a troubleshooting manual.
- When updating docs, rewrite the affected sections as if writing them for the first time; never patch old text or stack correction notes.
