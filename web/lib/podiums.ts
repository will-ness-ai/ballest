// Who holds the podium places across a season's Tracks, as build_podiums in
// tools/campaign_common.py tallied them: a tally per season, then one over every season's
// Tracks at once, which the All Seasons board shows beside its points. Only Tracks count:
// an Overall board is points, not a race.
import { CIRCUIT, COMPOSITE_GROUP, circuitBoard } from "./circuit";
import { isPoints } from "./rules";

export interface PodiumFinish {
  /* the Track's display name; in the All Seasons tally prefixed with its season */
  track: string;
  rank: number;
  score: number;
}

export interface PodiumPlayer {
  steamId: string;
  persona: string;
  avatar: string | null;
  gold: number;
  silver: number;
  bronze: number;
  finishes: Array<PodiumFinish>;
  /* equal counts share a rank (1, 2, 2, 4) */
  rank: number;
}

export interface PodiumTally {
  group: string;
  tracks: number;
  players: Array<PodiumPlayer>;
}

export interface Placing {
  board: string;
  steamId: string;
  persona: string;
  avatar: string | null;
  rank: number;
  score: number;
}

/* one tally: the top three of each of `tracks`, counted and ranked golds first, then
   silvers, then bronzes, and equal counts share a rank rather than being split by a key
   the reader can't see. `placings` are in Track order and rank order within a Track. */
function tally(
  group: string,
  tracks: ReadonlyArray<string>,
  placings: ReadonlyArray<Placing>,
  label: (board: string) => string,
): PodiumTally {
  const players = new Map<string, PodiumPlayer>();
  for (const name of tracks)
    for (const r of placings.filter((x) => x.board === name && x.rank <= 3)) {
      let p = players.get(r.steamId);
      if (!p) {
        p = {
          steamId: r.steamId,
          persona: r.persona,
          avatar: r.avatar,
          gold: 0,
          silver: 0,
          bronze: 0,
          finishes: [],
          rank: 0,
        };
        players.set(r.steamId, p);
      }
      p[(["gold", "silver", "bronze"] as const)[r.rank - 1]]++;
      p.finishes.push({ track: label(name), rank: r.rank, score: r.score });
    }
  /* a stable sort, so equal counts keep the order the Tracks met them in */
  const ordered = [...players.values()].sort(
    (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze,
  );
  ordered.forEach((p, i) => {
    const prev = i ? ordered[i - 1] : undefined;
    p.rank =
      prev?.gold === p.gold && prev.silver === p.silver && prev.bronze === p.bronze
        ? prev.rank
        : i + 1;
    p.finishes.sort(
      (a, b) => a.rank - b.rank || (a.track < b.track ? -1 : a.track > b.track ? 1 : 0),
    );
  });
  return { group, tracks: tracks.length, players: ordered };
}

/* Every season's tally that has Tracks, then All Seasons' when there is more than one. A
   Track counts once it has a placing, as build_podiums counted only the boards present. */
export function podiumTallies(placings: ReadonlyArray<Placing>): Array<PodiumTally> {
  const present = new Set(placings.map((p) => p.board));
  const tracks = CIRCUIT.filter((b) => !isPoints(b.name) && present.has(b.name));
  const groups = [...new Set(tracks.map((b) => b.group))];
  const display = (name: string) => circuitBoard(name)?.display ?? name;
  const seasons = groups
    .map((g) =>
      tally(
        g,
        tracks.filter((b) => b.group === g).map((b) => b.name),
        placings,
        display,
      ),
    )
    .filter((s) => s.tracks);
  if (seasons.length > 1)
    seasons.push(
      tally(
        COMPOSITE_GROUP,
        tracks.map((b) => b.name),
        placings,
        (name) => (circuitBoard(name)?.group ?? "") + " " + display(name),
      ),
    );
  return seasons;
}
