# Building a feature or fixing a bug

The default path for a new feature or a change players will notice, from idea to a PR
ready for review, and from the merge to a retrospective. Bug fixes and small changes skip
steps 1 to 3 and start at step 4, test-first, then take steps 5 to 8 like a feature: a fix is
ready for review only after its `/code-review` and `/codebase-design`, and gets its `/retro`
once merged. Data chores skip the planning steps too. Each step names the skill in `.claude/skills/` that runs it.

Some of these skills set `disable-model-invocation`, so the Skill tool refuses them unless
the user typed the slash command. When the workflow reaches one, read its `SKILL.md` and
follow it directly.

## 1. Plan: `/grill-with-docs`

Interview the user about the feature until the design tree is empty (`grilling`), while
`domain-modeling` keeps the vocabulary straight. This repo's glossary is `CONTEXT.md`, so
where that skill says `GLOSSARY.md`, read and write `CONTEXT.md`; ADRs go in `docs/adr/`,
only for decisions that are hard to reverse, surprising, and a real trade-off. Facts are
looked up, never asked: the board table, `docs/site.md`, `docs/data.md` and the committed
data answer most of them.

## 2. Design: `/grill-design`

When the feature has something players will see, settle its look in the running app: a
throwaway worktree on `claude/prototype-<slug>`, served locally, with the variants and a
picker built into the real page (give the worktree its own `pnpm install --prefer-offline`:
Turbopack rejects a symlinked `node_modules`). Five variants a round, walking from the overall layout
down to single components. Skip this step for collector, data and bot-engine work with no
visible surface.

## 3. Spec: `/to-spec`, then `/to-tickets`

Write the verdicts from steps 1 and 2 into a spec issue (labelled `ready-for-agent`) that
names the prototype branch, then split it into tickets with their blocking edges. A
feature small enough for one ticket still gets one, so `/implement-spec` has its frontier.

## 4. Build and open the PR: `/implement-spec`

Implement the tickets test-first (`tdd`, where tests exist: `discord-bot/` has them, the
site with its vitest tests, the smoke test and the served page, and the collector with
`tools/check_data.py`, per `CLAUDE.md`). A change to what the bot posts in Discord is also played through
in the sandbox (`discord-sandbox`). Work on a `claude/<slug>` branch and open a **draft** PR
that closes the spec and its tickets as soon as the branch has a commit.
It stays a draft through steps 5 and 6: step 7 marks it ready, in place of
`/implement-spec`'s own step 8.

## 5. Review: `/code-review`

Review the branch against `main` on both axes: `CODING_STANDARDS.md` (with every invariant
in `CLAUDE.md`) and the spec. `/implement-spec` runs this as its own step 7; that run is the
final review, so it isn't repeated. Fix every finding before moving on. Commits that land
after it (a fix found while testing, dev tooling) get `/code-review` since the last reviewed
commit before the merge.

A one-line fix gets the same review: call the Skill tool for 'code-review', which runs its
two reviewers as subagents on the diff. Your own read of the diff is implementation, not
review, and a brief asking for a light workflow trims the planning steps, never this one.

## 6. Deepen: `/codebase-design`

Call the Skill tool for 'codebase-design', a one-line fix included. With the feature working and reviewed, read the code it touched for deepening
opportunities: shallow modules, logic spread across callers, a seam in the wrong place.
Make the ones inside the PR's own code, and keep each one checked the same way the feature
was (tests, the smoke test, `check_data.py`, the served page). Anything wider becomes a note
in the PR, not part of it.

## 7. Update the PR

Push, then rewrite the PR description to match what landed (Before / After, and How,
including the design verdicts and the prototype branch), and mark it ready for review once
CI is green and the final commit itself has been checked: the smoke test, its preview
deploy, and, for a site change, a Refresh's revalidate end to end and the changed pages
against production (`docs/site.md`, "Checking a change"). A gap left unchecked goes in the
PR's Checked section as a gap. Remove the prototype worktree if `/grill-design` left one.

Merge `main` into the branch before marking it ready and again just before it merges, even
when GitHub shows no conflict. A long PR outlives conventions: while #152 was open, `main`
dropped `useModalKeys` for native dialogs and moved the CSS to rem type, oklch colors and
an em breakpoint, and each catch-up was a port that `check-styles` and `tsc` flagged, not a
textual conflict.

## 8. After the merge: `/retro`

When the PR is merged (the merge wakes any session watching it), run `/retro` on the
session or sessions that built the feature, using `writing-for-agents` for anything it
proposes to write. Present the candidates to the user, most severe first. The ones they
pick land as their own small PR: a check in CI or a lint rule for a mechanical
mistake, a rule in `CODING_STANDARDS.md` for a judgement call, a pointer in `AGENTS.md` or
a doc for something that was hard to find.

In cloud sessions without the `gh` CLI, the GitHub tools do what `docs/agents/issue-tracker.md`
lists.
