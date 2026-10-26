---
name: prefab-generators
description: Add or rework Generators on the Prefabs page's Generate your own tab (a sign, a tree, a building, any Prefab made from settings). Use when asked for a new generator or to improve how one looks.
---

# Prefab generators

The run that made the House, Tower and Castle (#310), as one sequence. A Generator lives in
`web/lib/generators/`; `docs/site.md`, "Generators", says what each file holds and how a
Generator is built. For this work the six steps below are the whole workflow, in place of
`docs/agents/feature-workflow.md`.

## 1. Brainstorm

When the ask names the Generators, take those. Otherwise put 5 to 8 ideas to the user, each a
name, its category (`CATEGORIES`, or a new one), a line on what it makes, and its main
controls. Recommend three. Done when the user has picked.

## 2. First draft

On a `claude/<slug>` branch from `origin/main`, in a worktree beside the checkout with its own
`pnpm install` in the root, `web/` and `discord-bot/` (the push hook lints all three). Beyond
what `docs/site.md` says:

- A new key goes in `GENERATOR_KEYS` (`lib/routes.ts`) in `GENERATORS`' order, and its page in
  `web/scripts/smoke.mjs`.
- Anything with a front faces -X, toward the camera that spawns it.
- Every slider's whole range stays within `PIECE_LIMIT`; a control's `max` can depend on the
  other values (the castle's Gate width).
- Tests first, through `generate()` and the control list, in `web/test/generators.test.tsx`.
  The per-Generator tests there already cover defaults, ranges, the largest settings and every
  collage variation; add one behaviour test per Generator (taller with more floors, no round
  pieces with towers off), red before green.

Done when `pnpm check` and `pnpm --dir web exec vitest run test/generators.test.tsx` pass and
the branch is pushed.

## 3. One grill-design round

Call the Skill tool for 'grill-design' and run one round on the question that most changes
how the Generators look: five variants (builders, shapes or defaults) behind `?variant=`. Cut
its `claude/prototype-<slug>` branch from the draft branch rather than from `origin/main`, so
the variants start from the draft. Hand the user the branch's Vercel preview, its address read
with `vercel inspect <deployment url> --scope n3sonlines-projects` (Vercel shortens a long
branch name). Bring the verdict back into the draft branch. Done when the user has picked.

## 4. Collage review

With the draft branch served (`pnpm --dir web dev`, or its preview), render each Generator in
every variation `variationsOf` lists, from three angles, one JPEG per Generator, and read each
once:

```bash
node .claude/skills/prefab-generators/collage.mjs http://localhost:3000 scratch/collage house tower
```

`<key>:control,control` narrows a collage to those controls. Look for what a player would call
broken: pieces floating or sunk, overlaps, things poking through walls or roofs, a variation
that makes nothing, a slider end that looks wrong, a front facing away. Fix in the builder, add
a test for each fix that is a rule (inside the walls, above the ridge), and render again. Done
when a round's collages show nothing broken.

Then, on Will's PC, spawn each Generator once in a sandbox copy of the game, a small variation
so it fits the editor's camera (the script's docstring says how to start the slot):

```bash
python .claude/skills/prefab-generators/spawn.py 1 house '{"width": 4, "floors": 1}'
```

Done when each spawned with its front toward the camera and its colours those the site's
viewer shows. A cloud session skips this and says so in the PR.

## 5. Code review

Call the Skill tool for 'code-review' with `origin/main` as the fixed point. Fix every finding,
with a test where it is a behaviour. Call it again from the last reviewed commit only when the
commits since make up half or more of the PR's changed lines (`docs/agents/feature-workflow.md`,
step 5); otherwise list what is left in the PR.

## 6. The PR

Open it from the draft branch with the repo's template: Before / After / How, and every Checked
line filled in (the grill-design verdict, tests first, each code-review round, the collage
rounds and the sandbox spawn under the qa line, and `/codebase-design` as skipped by this
skill). Ask the user whether to merge in the same reply that says CI is green; merge with a
squash on their word.
