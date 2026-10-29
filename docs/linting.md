# Formatting and linting

One setup covers the whole repo: Prettier formats, ESLint and Ruff lint, and CI fails on
anything either would change or report (`lint` in `.github/workflows/check.yml`).

| Files                                      | Formatter     | Linter                                                                 |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------- |
| TS in `discord-bot/`, `web/`               | Prettier      | ESLint, typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` |
| JS (`*.mjs`, configs)                      | Prettier      | ESLint, the same rules minus the type-aware ones                       |
| HTML, CSS, JSON, YAML, Markdown            | Prettier      |                                                                        |
| Python in `tools/`, `discord-bot/scripts/` | `ruff format` | `ruff check`, every rule on except those `ruff.toml` lists             |

The site adds three checks of its own to `pnpm lint`, each one a `CODING_STANDARDS.md` rule:
`site/no-client-values` (`web/eslint/`) stops a server
component importing a value from a `"use client"` module; `no-restricted-imports` keeps
React, Next and `db/` out of `web/lib/`; and `web/scripts/check-styles.mjs` fails on a color
literal outside `:root`.

## Running it

Once, at the repo root: `pnpm install`, plus `pnpm install` in `discord-bot/` and `web/`
(ESLint types each TS file through its own package's `tsconfig.json`, so those packages
need their dependencies), and Ruff (`uv tool install ruff@0.15.20`, or `pip install
ruff==0.15.20`; CI pins that version). A cloud session gets the installs from
`.claude/hooks/session-start.sh`. A project thread starts in `/home/user`, outside the repo,
so there the cloud environment's setup script runs that file:

```bash
CLAUDE_CODE_REMOTE=true /home/user/ballest/.claude/hooks/session-start.sh
```

and a thread whose container restarted runs the same line itself. Every Ruff script in
`package.json` first checks that the Ruff on PATH is the pinned one (`web/scripts/check-ruff.mjs`). Lint types the site's pages with Next's route types,
which `pnpm --dir web exec next typegen` writes (CI runs it first).

- `pnpm format` rewrites everything; `pnpm lint:fix` applies the safe lint fixes.
- `pnpm check` is what CI runs: `format:check` then `lint`.
- `git push` runs `pnpm check` first (`.githooks/pre-push`, about a minute) and stops on a
  failure, or on a push stacked on a PR that is already merged (`.githooks/merged-pr.mjs`). A root `pnpm install` that installs anything turns it on (`prepare` sets
  `core.hooksPath`), and so does `session-start.sh`; in an older checkout, run
  `git config core.hooksPath .githooks` once. `git push --no-verify` skips it.
- A database test that can't reach Postgres fails with a message naming
  `service postgresql start` (pytest stops at the first): a cloud container stops Postgres
  when it restarts.

## Settled choices

- **Line width 100**, for Prettier and Ruff alike: the width the code was already written to.
  Prettier leaves comments as written, so ESLint's `max-len` holds the site's comment lines to
  100 too (code gets a limit no line reaches; a comment trailing code is not checked). The bot
  keeps its one-line doc comments, many longer.
- **One root tooling package.** `package.json` at the root holds only dev tools. It is not a
  workspace: `discord-bot/` and `web/` keep their own lockfiles, so the Fly image and the
  Vercel build install exactly what they did before.
- **Every disabled rule says why**, in `eslint.config.js` or `ruff.toml`. A one-off exception
  is an inline `eslint-disable-next-line <rule> -- <reason>` or `# noqa: <code> (<reason>)`.
  The bot's tests turn off typescript-eslint's `no-unsafe-*` and `no-explicit-any`: they read
  JSON bodies back as they come.
- **Index reads are typed as present** (`noUncheckedIndexedAccess` is off), so
  `no-unnecessary-condition` rejects `m[1] ?? "all"` on a regex group, and `if (first)` after
  `const [first] = list`. Read a value that may be missing with `.at()`: `list.at(0)`,
  `slot.at(1) ?? "all"`, or type it as what it is: `(m[1] as string | undefined) ?? "all"`.
- **Not linted**: `leth/` (a frozen snapshot), a local `data/`, the vendored
  `.claude/skills/`. `.prettierignore` and the `globalIgnores` in `eslint.config.js` list them.
- **The legacy Steamworks-SDK scripts** (`tools/README-hosting.md`) are formatted and linted
  for bugs, but keep their style (SDK struct names, bare `open()`): they only run on Windows
  against the SDK, so a restyle could not be tested.

## Merging a branch from before the reformat

A branch cut before the reformat conflicts on nearly every line it touched. Resolve each
conflicted file by taking the branch's side, then format it:
`git checkout --theirs <file> && pnpm exec prettier --write <file>` (or `ruff format <file>`
for Python). The branch's change survives and the formatting matches `main`.
