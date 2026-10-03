---
name: grill-design
description: Converge on a feature's look through rounds of live prototypes and grilling verdicts, run in the real app on a throwaway worktree. Use when a planned feature has something players will see (the site or the bot's Activity), or the user wants to iterate on UI against concrete variants.
---

Adapted for this repo from `grill-design` in `will-ness-ai/skills` (at `71d8909`): the
prototypes live in the running app on a throwaway worktree, not in a standalone Artifact,
so every variant is judged against real data, the real header and the real density.

Run a `/grilling` session in which each question is asked with prototypes, not words.

## Set up the prototype worktree once

1. Pick a short slug for the feature and create a worktree off `main` on a throwaway
   branch, outside the checkout:

   ```bash
   git worktree add ../ballest-prototype-<slug> -b claude/prototype-<slug> origin/main
   ```

2. Serve it on a free port, from the worktree's root:

   ```bash
   python -m http.server <port> -d ../ballest-prototype-<slug>
   ```

   (the `ballest` config in `.claude/launch.json` does the same with no caching when
   started from the worktree). For the bot's Activity, run `pnpm --dir discord-bot
   activity:demo` in the worktree instead (port 8740). The data in `data/` is the
   committed data, so every board and player is real.

3. Hand the user the URL with the route the feature lives on, e.g.
   `http://localhost:<port>/?variant=A#/players`. If the session runs in the cloud and the
   user cannot open its localhost, screenshot each variant and state with Playwright
   (Chromium is preinstalled) and post the images instead, keeping the URL for when they
   run it themselves.

## Each round

- Build **5 radically different** variants of the current design question inside the
  real page (`index.html`, or the Activity's page), on the route the feature belongs on.
  Only the feature's own subtree changes per variant; routing, data loading and the rest
  of the page stay as they are. Variants disagree about structure (layout, hierarchy,
  primary affordance), not just colour or copy.
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
