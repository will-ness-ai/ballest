# Formatting and linting

One setup covers the whole repo: Prettier formats, ESLint and Ruff lint, and CI fails on
anything either would change or report (`lint` in `.github/workflows/check.yml`).

| Files                                      | Formatter     | Linter                                                                 |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------- |
| TS in `discord-bot/`, `web/`               | Prettier      | ESLint, typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` |
| JS (`*.mjs`, configs)                      | Prettier      | ESLint, the same rules minus the type-aware ones                       |
| `index.html`'s inline script               | Prettier      | `tools/page-check` (ESLint recommended + best-practice rules)          |
| HTML, CSS, JSON, YAML, Markdown            | Prettier      |                                                                        |
| Python in `tools/`, `discord-bot/scripts/` | `ruff format` | `ruff check`, every rule on except those `ruff.toml` lists             |

## Running it

Once, at the repo root: `pnpm install`, plus `pnpm install` in `discord-bot/` and `web/`
(ESLint types each TS file through its own package's `tsconfig.json`, so those packages
need their dependencies), and Ruff (`uv tool install ruff@0.15.20`, or `pip install
ruff==0.15.20`; CI pins that version).

- `pnpm format` rewrites everything; `pnpm lint:fix` applies the safe lint fixes.
- `pnpm check` is what CI runs: `format:check` then `lint`.

## Settled choices

- **Line width 100**, for Prettier and Ruff alike: the width the code was already written to.
- **One root tooling package.** `package.json` at the root holds only dev tools. It is not a
  workspace: `discord-bot/` and `web/` keep their own lockfiles, so the Fly image and the
  Vercel build install exactly what they did before. The site itself still has no build step.
- **Every disabled rule says why**, in `eslint.config.js` or `ruff.toml`. A one-off exception
  is an inline `eslint-disable-next-line <rule> -- <reason>` or `# noqa: <code> (<reason>)`.
  The bot's tests turn off typescript-eslint's `no-unsafe-*` and `no-explicit-any`: they read
  JSON bodies back as they come.
- **Not linted**: `leth/` (a frozen snapshot), `data/` (CI-written), the vendored
  `.claude/skills/`. `.prettierignore` and the `globalIgnores` in `eslint.config.js` list them.
- **The legacy Steamworks-SDK scripts** (`tools/README-hosting.md`) are formatted and linted
  for bugs, but keep their style (SDK struct names, bare `open()`): they only run on Windows
  against the SDK, so a restyle could not be tested.

## Merging a branch from before the reformat

A branch cut before the reformat conflicts on nearly every line it touched. Resolve each
conflicted file by taking the branch's side, then format it:
`git checkout --theirs <file> && pnpm exec prettier --write <file>` (or `ruff format <file>`
for Python). The branch's change survives and the formatting matches `main`.
