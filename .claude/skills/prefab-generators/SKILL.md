---
name: prefab-generators
description: Add or rework Generators on the Prefabs page's Make your own tab (a sign, a tree, a building, any Prefab made from settings). Runs brainstorm, first draft, one grill-design round, a collage review, code-review and the PR. Use when asked for a new generator or to improve how one looks.
---

# Prefab generators

The run that made the House, Tower and Castle (#310), as one sequence. A Generator lives in
`web/lib/generators/` (`docs/site.md`, "Generators", says what each file holds); this skill is
how a new one gets there. It replaces `docs/agents/feature-workflow.md` for this work: no spec
or tickets, no `/codebase-design` pass.

## 1. Brainstorm

When the ask names the Generators, take those. Otherwise put 5 to 8 ideas to the user, each a
name, its category (`CATEGORIES`, or a new one), a line on what it makes, and its main
controls. Recommend three. Done when the user has picked.

## 2. First draft

On a `claude/<slug>` branch from `origin/main` (a worktree beside the checkout, its own
`pnpm install` in the root, `web/` and `discord-bot/`, since the push hook lints all three):

- Each Generator is one entry in its category's file (`signs.ts`, `nature.ts`,
  `buildings.ts`, or a new file beside them), added to `GENERATORS` in `index.ts` and
  `GENERATOR_KEYS` in `lib/routes.ts` in the same order, and its page to `web/scripts/smoke.mjs`.
- Build from `pieces.ts`: `piece` (bottom centre), `boxAt` (a box's centre, any rotation),
  `pyramid`, the `COLOURS` the editor paints. Anything with a front faces -X.
- Every slider's whole range has to stay within `PIECE_LIMIT`: give a control a `max` that
  depends on the other values when it has to (the castle's Gate width).
- Tests first, through `generate()` and the control list, in `web/test/generators.test.tsx`:
  the existing per-Generator tests cover defaults, ranges, the largest settings and every
  collage variation; add one behaviour test per Generator (taller with more floors, no round
  pieces with towers off). Red before green.

Done when `pnpm check` and `pnpm --dir web exec vitest run test/generators.test.tsx` pass and
the branch is pushed.

## 3. One grill-design round

Call the Skill tool for 'grill-design' and run one round on the question that most changes
how the Generators look: five variants (builders, shapes or defaults) behind `?variant=`, on a
`claude/prototype-<slug>` branch cut from the draft. Hand the user the branch's Vercel preview
(read its address with `vercel inspect <deployment url> --scope n3sonlines-projects`: a long
branch name is shortened). Bring the verdict back into the draft branch. Done when the user has
picked.

## 4. Collage review

With the draft branch served (`pnpm --dir web dev`, or its preview), render each Generator in
every variation (`variationsOf`: the defaults, each number at its least and most, each option,
each switch) from three angles, one JPEG per Generator, and read each once:

```bash
node .claude/skills/prefab-generators/collage.mjs http://localhost:3000 scratch/collage house tower
```

`<key>:control,control` narrows a collage to those controls. Look for what a player would call
broken: pieces floating or sunk, overlaps, things poking through walls or roofs, a variation
that makes nothing, a slider end that looks wrong, a front facing away. Fix in the builder,
add a test for each fix when it is a rule (inside the walls, above the ridge), and render again.
Done after two rounds with nothing broken left in the collages.

Then, on Will's PC, spawn each Generator once in a sandbox copy of the game, a small variation
so it fits the editor's camera:

```bash
python .claude/skills/prefab-generators/spawn.py 1 house '{"width": 4, "floors": 1}' --sandbox ../bpm-sandbox-tools/tools/sandbox.py
```

(its docstring says how to start the slot). Done when each spawned with the colours named and
its front toward the camera. A cloud session skips this and says so in the PR.

## 5. Code review

Call the Skill tool for 'code-review' with `origin/main` as the fixed point. Fix every finding,
with a test where it is a behaviour. When the fixes come to 40 changed lines or more, call it
again from the last reviewed commit. Done when a round finds nothing left to fix.

## 6. The PR

Open it from the draft branch with the repo's template: Before / After / How, and the Checked
lines filled in (the grill-design verdict, tests first, each code-review round, the collage
rounds, the sandbox spawn). Ask the user whether to merge in the same reply that says CI is
green; merge with a squash on their word.
