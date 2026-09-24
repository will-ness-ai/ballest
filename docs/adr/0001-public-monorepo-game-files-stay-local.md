# Public monorepo, but the map-making kit stays a separate private repo

The Ballest community tools (the leaderboard site, its collector, the Leth viewer, and
the Discord bot) live in one public repo. The map-making kit is left out and stays a
private repo of its own. It commits level dumps and screenshots extracted from the
game's paks, which are the developers' assets, and merging it here would publish them,
even if they were only in its history.

## Considered Options

- Merging the kit and gitignoring its game-derived files: the kit only works with those
  files, and its history would still have to be rewritten or dropped.
- Making the monorepo private: loses free GitHub Pages hosting.
