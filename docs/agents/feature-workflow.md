# Building a feature or fixing a bug

The default path for a new feature or a change players will notice, from idea to a PR
ready for review, and from the merge to a retrospective. Bug fixes and small changes skip
steps 1 to 3 and start at step 4, test-first, then take steps 5 to 8 like a feature: a fix is
ready for review only after its `/code-review` and `/codebase-design`, and gets its `/retro`
once merged. Data chores skip the planning steps too. Each step names the skill in `.claude/skills/` that runs it.

The Skill tool refuses the ones `CLAUDE.md` names under "Agent skills"; when the workflow
reaches one, read its `SKILL.md` and follow it directly. Call every other step's skill,
`/code-review` and `/codebase-design` included, with the Skill tool.

## 1. Plan: `/grill-with-docs`

Interview the user about the feature until the design tree is empty (`grilling`), while
`domain-modeling` keeps the vocabulary straight in `GLOSSARY.md`; ADRs go in `docs/adr/`,
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
A feature that adds pages gives the `tiny` or `stress` seed (`web/db/seed/`) the data they need in its
first ticket, with smoke routes and `qa` catalogue rows, so CI draws every later ticket's
pages instead of a 404.

## 4. Build and open the PR: `/implement-spec`

Implement the tickets test-first where tests exist (`discord-bot/` has them, the
site with its vitest tests, the smoke test and the served page, and the collector with
`tools/tests/`, per `CLAUDE.md`): call the Skill tool for 'tdd'. A change to what the bot posts in Discord is also played through
in the sandbox: call the Skill tool for 'discord-sandbox'. Work on a `claude/<slug>` branch and open a **draft** PR
that closes the spec and its tickets as soon as the branch has a commit.
It stays a draft through steps 5 and 6: step 7 marks it ready, in place of
`/implement-spec`'s own step 8.

Each implementer's brief says:

- **Commit as you go.** Commit and push after each piece that passes its tests. A cloud
  container restart stops a running subagent, and only what it pushed survives for the next
  one to pick up.
- **One plain command per call.** The worktree guard refuses a compound command (`&&`, a
  pipe, `cd` then a command) as too complex to check, so run `git -C <worktree> ...` and
  tools with absolute paths, one per call.
- **Never check out in the main checkout.** Switch branches only in your own worktree: a
  checkout in `/home/user/ballest` leaves the session that owns it on someone else's branch or
  a detached HEAD (#346). The pre-push hook refuses a push from a detached HEAD.
- **Look at a page** with `qa check` (step 7), or `pnpm --silent qa shot <view> --el <selector>`
  for one element at one width: every image read stays in context for the session.

## 5. Review: `/code-review`

Review the branch against `main` on both axes: `CODING_STANDARDS.md` (with every invariant
in `CLAUDE.md`) and the spec. `/implement-spec` runs this as its own step 7; that run is the
final review, so it isn't repeated. Fix every finding before moving on, checking one that
asks for something the spec never named against `CODING_STANDARDS.md` first: #212 built a
real 404 the standards rule out, then deleted it. Commits that land
after it (a fix found while testing, dev tooling) get `/code-review` since the last reviewed
commit before the merge only when they change a significant part of the PR: as many lines, or
more, as the commits each skill last saw (half the PR, counted per commit).
Anything less, the fixes for a review's own findings included, needs no new round (Will,
2026-10-24: #366's fixes for each round's findings set off three more under a fixed 40 lines).
Batch a round's fixes into one commit; findings a fix's own new code raises are a judgement
call to list in the PR, not a reason for another round.

A one-line PR gets the same first review: call the Skill tool for 'code-review', which runs its
two reviewers as subagents on the diff. Your own read of the diff is implementation, not
review, and a brief asking for a light workflow trims the planning steps, never this one.

A hook holds both steps (`.claude/hooks/review-gate.mjs`): it notes the commit each Skill-tool
`/code-review` and `/codebase-design` runs on, and refuses an agent's merge, auto-merge or
mark-ready while the PR has a commit either hasn't seen, unless every such commit together is a
follow-up under that half (`unreviewed` in `review-gate-rules.mjs`). A commit that changes only
binary pictures (a skin, a screenshot) has nothing to review, so it needs neither skill. When
the session's Skill tool can't find a missing skill (no `SKILL.md` in the project's or
`~/.claude/skills`; a project thread's project is `/home/user`, where `session-start.sh` links
the repo's skills; or its transcript shows the Skill tool calling it unknown, as a project
thread's linked skills can still be), it only warns: follow that `SKILL.md` by hand and say so
in the PR. It also refuses a merge of this repo's PRs that doesn't squash (`docs/agents/issue-tracker.md`).
Its record is the clone's (`.git/claude-reviews`, shared by worktrees and sessions), so run them
in the clone that merges. When it can't check (gh offline, say) it lets the call through with a
warning, and it never sees a merge pressed on GitHub.

## 6. Deepen: `/codebase-design`

Call the Skill tool for 'codebase-design', a one-line PR included, then again only when
the follow-ups outgrow step 5's small-follow-up rule. With the feature working and reviewed, read the code it touched for deepening
opportunities: shallow modules, logic spread across callers, a seam in the wrong place.
Make the ones inside the PR's own code, and keep each one checked the same way the feature
was (tests, the smoke test, the served page). Anything wider becomes a note
in the PR, not part of it.

## 7. Update the PR

Push, then call the Skill tool for 'pr' and rewrite the PR description with it to match what
landed: Summary (with the design verdicts and the prototype branch), Evidence, Merge Danger and
Checked, the sections of `.github/pull_request_template.md`. Mark it ready for review once
CI is green and the final commit itself has been checked: the smoke test, its preview
deploy, and, for a site change, a Refresh's revalidate end to end and the changed pages
against production with `pnpm --silent qa check` (`docs/site.md`, "Checking a change"). A
QA brief for a subagent says the same: run `qa check` first, read only the pictures it
writes, and add a catalogue row for any page or dialog it does not draw. A gap left unchecked goes in the
PR's Checked section as a gap. Remove the prototype worktree if `/grill-design` left one.

To wait for a PR's CI, run `pnpm --silent pr wait <n>` at the root: it returns when the head's
checks and preview have finished, with green and the preview's URL, or the checks that went red.
A red check: run `pnpm --silent pr why <n>` first. It prints each failed
check's failed step and its annotations, qa's report among them, in one call, where a cloud
session can't download the job log.

A PR that adds a table can't get a working preview: previews read the production
database and skip migrations, so a page that reads the table fails to build until production
has it. To check it there before the merge, ask Will in the thread for a typed OK to apply that
migration to production, then, once the migration is final, run `.github/workflows/migrate.yml`
on the PR's branch (`gh api -X POST repos/will-ness-ai/ballest/actions/workflows/migrate.yml/dispatches -f ref=<branch>`).
It refuses a branch whose migrations aren't main's plus new ones, so merge main first, or when
another branch's migration already ran ahead of main. Then redeploy the preview
(`npx vercel redeploy <preview url> --token "$VERCEL_TOKEN"`). From then on that PR merges
before any other PR with a migration: Drizzle applies only migrations newer than production's
newest, so an older one merged after it would be skipped without an error (regenerate it if so). The real fix is a Neon branch per preview.

Merge `main` into the branch before marking it ready and again just before it merges, even
when GitHub shows no conflict. A long PR outlives conventions: while #152 was open, `main`
dropped `useModalKeys` for native dialogs and moved the CSS to rem type, oklch colors and
an em breakpoint, and each catch-up was a port that `check-styles` and `tsc` flagged, not a
textual conflict.

When Will says "merge", run `pnpm --silent pr land <n>` at the root. Other threads merge
often, so it brings `main` in when the head is behind (GitHub's update-branch), waits for that
head's CI and preview, marks a draft ready and squash-merges, stopping on red CI or a conflict
with the next command to run. The review gate checks it like any merge. A conflict is yours to
merge locally, and a later push needs `git pull` first, since update-branch adds a commit. The session's permission check can refuse to merge a PR with no approving review;
then say so in one line and try again on Will's next word, naming the PR.

Will's "merge" can land on GitHub long before its merged event reaches the session (#237 took
47 minutes), so commits pushed in between never reach `main`. The pre-push hook
(`.githooks/merged-pr.mjs`) refuses a push stacked on a merged PR: restart the branch from
`main`, bring the new commits over, and open a new PR.

## 8. After the merge: `/retro`

When the PR is merged (the merge wakes any session watching it), run `/retro` on the
session or sessions that built the feature, using `writing-for-agents` for anything it
proposes to write. Present the candidates to the user, most severe first. The ones they
pick land as their own small PR: a check in CI or a lint rule for a mechanical
mistake, a rule in `CODING_STANDARDS.md` for a judgement call, a pointer in `AGENTS.md` or
a doc for something that was hard to find.

In cloud sessions without the `gh` CLI, the GitHub tools do what `docs/agents/issue-tracker.md`
lists.
