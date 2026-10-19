---
name: grill-design
description: Converge on a feature's look through rounds of live prototypes and grilling verdicts, run in the real app on a throwaway worktree. Use when a planned feature has something players will see (the site or the bot's Activity), or the user wants to iterate on UI against concrete variants.
---

Adapted for this repo from `grill-design` in `will-ness-ai/skills` (at `71d8909`): the
prototypes live in the running app on a throwaway worktree, not in a standalone Artifact,
so every variant is judged against real data, the real header and the real density.

Call the Skill tool for 'grilling', and ask each of its questions with prototypes, not words.

## Set up the prototype worktree once

1. Pick a short slug for the feature and create a worktree off `main` on a throwaway
   branch, outside the checkout:

   ```bash
   git worktree add ../ballest-prototype-<slug> -b claude/prototype-<slug> origin/main
   ```

2. Give the worktree its own `pnpm install --prefer-offline` in `web/` (Turbopack rejects a
   symlinked `node_modules`), then serve it on a free port against a database backfilled
   from `data/`'s git history (`docs/data.md`), so every board and player is real:

   ```bash
   pnpm --dir ../ballest-prototype-<slug>/web dev:up <port>
   ```

   `dev:down <port>` stops it. For the bot's Activity, run `pnpm --dir discord-bot activity:demo` in the worktree
   instead (port 8740). Push the branch too: its Vercel preview is a link the user can open
   away from their PC.

3. Hand the user the URL with the route the feature lives on, e.g.
   `http://localhost:<port>/players?variant=A`. If the session runs in the cloud and the
   user cannot open its localhost, screenshot each variant and state with Playwright
   (Chromium is preinstalled) and post the images instead, keeping the URL for when they
   run it themselves. Shoot each variant twice, on the plain URL (no `?view=`) with a
   390px viewport and a 1280px one. Shoot at `deviceScaleFactor: 1`, clipped to the feature's element,
   as JPEG (`quality: 80`) at most 1000px wide. Read one per round to check the shots came
   out and send the rest unread: every image read stays in context for the session.

## Each round

- Build **5 radically different** variants of the current design question inside the
  real page (the app in `web/`, or the Activity's page), on the route the feature belongs on.
  Only the feature's own subtree changes per variant; routing, data loading and the rest
  of the page stay as they are. Variants disagree about structure (layout, hierarchy,
  primary affordance), not just colour or copy.
- A variant changes only what the round asks. Anything else it moves or removes (a stat,
  a label, a corner) is named in its picker description, so a verdict never adopts a
  change the user didn't see.
- The active variant comes from a `?variant=<key>` search parameter, which sits next to
  the hash route without disturbing it, so every variant is a link the user can share or
  reload.
- A floating, draggable picker sits bottom-right. It names the current variant
  (`B · Sidebar`), and its ←/→ buttons and the ←/→ keys cycle the variants (not while an
  input has focus), updating `?variant=` with `history.replaceState` so the hash route is
  kept. When the design has meaningful states (a board with 1, 2 or thousands of rows; a
  player with and without Workshop times; an empty search), add picker buttons that
  toggle between them through a `?state=` parameter. The picker is plainly not part of
  the design: a high-contrast pill above everything else.
- Every round's picker has **Desktop** and **Phone** buttons, so each variant is judged
  at both sizes. Phone sets `?view=phone` and lays a full-screen scrim over the page
  holding a 390px-wide `<iframe>` of the same URL with `view` removed and `framed=1`
  added, keyed on that URL so it follows the variant (on a variant that changes route,
  re-read the URL after the navigation). A page loaded with `?framed=1` draws no picker,
  so the one outside drives it. `ProtoPicker` in `web/components/prototype/SkinPick.tsx`
  and `.proto-frame` in `web/app/styles/prototype.css`, on `claude/prototype-skin-pick`,
  are a working copy: keep the view switch and the frame, and leave its Skin hooks behind.
- Put the picker and the variants in one clearly marked `PROTOTYPE` block so they are
  easy to find and never mistaken for production code. Reload the page after each edit
  (a hash change keeps the old script).
- Commit the round on the prototype branch (`prototype: round N, <question>`), then ask
  the round's question with the variants as the options, and wait for the verdict.
- Rebuild the variants in place for the next round. The URL stays the same.

The grilling walks down the visual design tree, each verdict zooming in one level: the
overall design, then component groups, then individual components, until the user has
designed the entire feature in detail. Check each round against `CODING_STANDARDS.md`'s
page rules (colours from `:root`, phone-first with one desktop block, any board size), so
the winner can be built as designed.

## When the frontier is empty

- Write down the verdicts: the question each round settled and the variant that won,
  with the parts the user took from others. This feeds `/to-spec`.
- Push the prototype branch so it is kept as a primary source, and name it in the spec.
  It is never merged: the winner is rebuilt properly, with tests where they exist, by
  `/implement-spec`.
- Stop the server and remove the worktree (`git worktree remove ../ballest-prototype-<slug>`).
