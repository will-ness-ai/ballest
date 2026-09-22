# Leth Trial #1 ghost viewer

A static 3D replay of the Steam leaderboard for **Leth Trial #1**, the Collabs event map,
served at https://ballest.willness.dev/leth/ off the same GitHub Pages branch as the main
site. Pick players from the list and their ghosts replay together over the map; the event let
you take the nine checkpoints in any order, so the point of the page is comparing *routes*.

Self-contained: nothing here is loaded by the main site, and the main site's collector never
writes here.

## Layout

- `index.html` — the whole app. Vanilla JS plus Three.js r128 from jsDelivr, so unlike the
  root site this page does use a JS CDN.
- `data/ghosts.js` — the top 300 entries: board rank, name, time, checkpoint order, splits,
  and the ~10 Hz position samples of each ghost replay.
- `data/rings.js` — the nine goal rings as world transforms (`BP_Checkpoint` actors).
- `data/map2.js` — the red track platforms as oriented boxes.

These are frozen snapshots, not something the page refreshes: they were built from a Steam
read of leaderboard `Map_LethTrial_01` (id `20899741`), the ghost replay each entry carries,
and the level's own actor transforms. The event is over and the board no longer moves, so
there is no collector here — regenerate and commit if a snapshot has to change.

## Things worth knowing before you edit

**Checkpoint numbering is this page's invention.** The game gives the nine checkpoints no
numbers, so `1..9` here is the *world record's* pickup order, and the colour names (Orange,
Red, Yellow, Dark, Sky blue, Pink, Grey, Blue, Lime) come from the emissive material on the
bumper blocks beside each one. Renumbering breaks every route string people have shared.

**A ghost's route is derived, not stored.** The replay holds `?CheckpointSplits` (nine
cumulative times) but never says which checkpoint each split belongs to, so the position is
interpolated at each split time and matched to the nearest checkpoint. It resolves cleanly —
worst case 5.8 m from a ring centre, comfortably inside the 7.5 m rings.

**Unreal is left-handed and the viewer is not.** Every position and transform is converted
once on the way into the data files (`y` negated, then `z` becomes the up axis). Drawing raw
game coordinates mirrors the map north-to-south, which is exactly the bug that shipped in the
first render.

**Times are seconds, already converted.** The Steam score is in hundred-thousandths of a
second (the `SCORE_TICKS_PER_SECOND` invariant the root site lives by); the generator divides
by 100000 before writing `time`.

**Data file names are cache-busting.** `map2.js` is `map.js` with a new name after a stale
copy survived a hard reload. If a data file changes shape, bump its name rather than fighting
the cache.
