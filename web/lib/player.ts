// Everything the site shows about a player, worked out in one place (docs/site.md, "The
// player page"): the board table is read here and nowhere below, so a player page, the
// head to head and the score card are only markup over a PlayerRecord. matchup() is the
// one place two records are paired up. Pure, so the server and the browser share it.
import { COMPOSITE_BOARD, S1_CURRENT_BOARD } from "./circuit";
import type { PlayerData, WorkshopMap } from "./rows";
import {
  SCORE_TICKS_PER_SECOND,
  MEDAL_KEYS,
  isPoints,
  seasonTag,
  medalOf,
  timeMedal,
  trackPoints,
  type MedalKey,
} from "./rules";

export interface IndexBoard {
  name: string;
  group: string;
  tier: string | null;
  display: string;
  entryCount: number;
}

export interface Who {
  steamId: string;
  persona: string;
  avatar?: string | null;
}

export interface TrackTile {
  name: string;
  display: string;
  field: number;
  finish: { rank: number; score: number; lead: number } | null;
  /* what the place pays toward the season's Overall */
  points: number;
}

export interface SeasonRecord {
  group: string;
  overall: { rank: number; score: number } | null;
  tiers: Array<{ tier: string; tracks: Array<TrackTile>; points: number }>;
  /* what the Tracks add up to; Steam's Overall can lag behind it */
  points: number;
  lagging: boolean;
}

export interface WorkshopFinish {
  name: string;
  pfid: string;
  display: string;
  creator: string;
  preview: string | null;
  created: number;
  field: number;
  rank: number;
  score: number;
  gap: number;
  /* what the row shows: a world record, else the Medal its time earned */
  medal: MedalKey;
  /* the Medal the time earned by itself, which a world record does not replace */
  earned: MedalKey;
  holder: Who;
}

/* whether a finish counts under one of the Workshop tab's Medal tiles. A world record is
   its rank and a Medal is its time, counted apart: a record at the author time counts
   under both, and a slower one under the Medal its time earned (CONTEXT.md, Medal) */
export function countsUnder(f: WorkshopFinish, k: MedalKey) {
  return k === "wr" ? f.rank === 1 : f.earned === k;
}

export interface MadeMap {
  name: string;
  display: string;
  preview: string | null;
  author: number;
  runs: number;
  subs: number;
  beaten: number;
  record: { score: number; who: Who } | null;
}

export interface PlayerRecord {
  id: string;
  profileUrl: string | null;
  who: Who;
  allSeasons: { rank: number; score: number } | null;
  medals: { gold: number; silver: number; bronze: number };
  golds: Array<string>;
  run: number;
  tracks: number;
  seasons: Array<SeasonRecord>;
  workshop: {
    finishes: Array<WorkshopFinish>;
    medals: Record<MedalKey, number>;
    maps: number;
    podiums: number;
    near: number;
  };
  made: Array<MadeMap>;
  holds: number;
  /* the tab /player/<id> opens on */
  home: "workshop" | "circuit";
}

/* The Circuit's seasons in the order the site shows them: the current season leads, and
   a group with no number (All Seasons) goes after the seasons it is made from */
export function groupsOf(boards: ReadonlyArray<{ group: string }>) {
  return [...new Set(boards.map((b) => b.group))].sort((a, b) => {
    const na = parseInt(a.replace(/\D+/g, ""), 10),
      nb = parseInt(b.replace(/\D+/g, ""), 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1;
    return a.localeCompare(b);
  });
}

/* the Overall board a season opens on: Season 1's current one ahead of Steam's final */
export function overallOf(boards: ReadonlyArray<IndexBoard>, group: string) {
  const own = boards.filter((b) => b.group === group);
  return own.find((b) => b.name === S1_CURRENT_BOARD) ?? own.find((b) => isPoints(b.name));
}

export function playerRecord(
  data: PlayerData,
  boards: ReadonlyArray<IndexBoard>,
  maps: ReadonlyArray<WorkshopMap>,
): PlayerRecord {
  const id = data.profile.steamId;
  const by = new Map(data.finishes.map((f) => [f.board, f]));
  const timed = maps.filter((m) => m.top3.length);
  const finishes: Array<WorkshopFinish> = [];
  for (const m of timed) {
    const f = by.get(m.name);
    if (!f) continue;
    finishes.push({
      name: m.name,
      pfid: m.pfid,
      display: m.title,
      creator: m.creator,
      preview: m.preview,
      created: m.created,
      field: m.entryCount,
      rank: f.rank,
      score: f.score,
      gap: f.score - f.lead,
      medal: medalOf(m.medals, f.rank, f.score),
      earned: timeMedal(m.medals, f.score),
      holder: { steamId: m.top3[0][0], persona: m.top3[0][1] },
    });
  }
  const byMedal = Object.fromEntries(
    MEDAL_KEYS.map(([k]) => [k, finishes.filter((f) => countsUnder(f, k)).length]),
  ) as Record<MedalKey, number>;
  /* every Map they published, timed or not; one with no time has no board to link to */
  const timedNames = new Set(timed.map((m) => m.name));
  const made = maps
    .filter((m) => m.cid === id)
    .map((m) => {
      const t = timedNames.has(m.name);
      return {
        name: m.name,
        display: m.title,
        preview: m.preview,
        author: m.medals[3] ?? 0,
        runs: t ? m.entryCount : 0,
        subs: m.subs,
        beaten: t ? m.authorBeaten : 0,
        record: t
          ? { score: m.top3[0][2], who: { steamId: m.top3[0][0], persona: m.top3[0][1] } }
          : null,
      };
    })
    .sort((a, b) => b.runs - a.runs || b.subs - a.subs);
  const tracks: Array<TrackTile> = boards
    .filter((b) => !isPoints(b.name))
    .map((b) => {
      const f = by.get(b.name);
      return {
        name: b.name,
        display: b.display,
        field: b.entryCount,
        finish: f ? { rank: f.rank, score: f.score, lead: f.lead } : null,
        points: f ? trackPoints(f.rank) : 0,
      };
    });
  const run = tracks.filter((t) => t.finish);
  const medals = { gold: 0, silver: 0, bronze: 0 };
  for (const t of run) {
    const r = t.finish?.rank ?? 0;
    if (r >= 1 && r <= 3) medals[(["gold", "silver", "bronze"] as const)[r - 1]]++;
  }
  const byName = new Map(tracks.map((t) => [t.name, t]));
  /* A season is a group that actually raced; All Seasons has no Tracks, so it falls out
     here and shows in the header line instead. A season's Tracks sit under the in-game
     difficulty headings, and a season with none is one unheaded run. */
  const seasons = groupsOf(boards)
    .map((season) => {
      const headed: SeasonRecord["tiers"] = [];
      for (const b of boards.filter((x) => x.group === season && !isPoints(x.name))) {
        const tier = b.tier ?? "Circuit";
        const t = byName.get(b.name);
        if (!t) continue;
        let cur = headed.at(-1);
        if (cur?.tier !== tier) {
          cur = { tier, tracks: [], points: 0 };
          headed.push(cur);
        }
        cur.tracks.push(t);
        cur.points += t.points;
      }
      const overallBoard = overallOf(boards, season);
      const o = overallBoard ? by.get(overallBoard.name) : undefined;
      const overall = o ? { rank: o.rank, score: o.score } : null;
      const points = headed.reduce((n, t) => n + t.points, 0);
      return {
        group: season,
        overall,
        tiers: headed,
        points,
        lagging: !!overall && overall.score !== points,
      };
    })
    .filter((s) => s.tiers.length);
  const comp = by.get(COMPOSITE_BOARD);
  return {
    id,
    profileUrl: data.profile.profileUrl,
    who: { steamId: id, persona: data.profile.persona, avatar: data.profile.avatar },
    allSeasons: comp ? { rank: comp.rank, score: comp.score } : null,
    medals,
    golds: run.filter((t) => t.finish?.rank === 1).map((t) => t.display),
    run: run.length,
    tracks: tracks.length,
    seasons,
    workshop: {
      finishes,
      medals: byMedal,
      maps: maps.length,
      podiums: finishes.filter((f) => f.rank <= 3).length,
      near: finishes.filter((f) => f.rank > 1 && f.gap <= SCORE_TICKS_PER_SECOND).length,
    },
    made,
    holds: made.filter((m) => m.record?.who.steamId === id).length,
    home: finishes.length ? "workshop" : "circuit",
  };
}

export interface MatchRow {
  scope: "workshop" | "circuit";
  name: string;
  title: string;
  preview?: string | null;
  field: number;
  a: { rank: number; score: number };
  b: { rank: number; score: number };
  /* a's score less b's: below 0 means A was faster */
  d: number;
  win: "a" | "b" | "tie";
  /* the margin as a share of the faster time, so a close call on a long Map sorts
     beside one on a short */
  rel: number;
}

export interface Tally {
  n: number;
  a: number;
  b: number;
}

export interface BandStat {
  label: string;
  a: number | null;
  b: number | null;
  /* a rank, better low; otherwise a count, better high */
  rank: boolean;
  win: "a" | "b" | null;
}

export interface Matchup {
  rows: Array<MatchRow>;
  tally: { all: Tally; circuit: Tally; workshop: Tally };
  band: Array<BandStat>;
}

/* A against B: the rows both have a time on, each with its winner and margin, the tally
   for each scope, and the comparison band */
export function matchup(A: PlayerRecord, B: PlayerRecord): Matchup {
  const rows: Array<MatchRow> = [];
  const pair = (r: Omit<MatchRow, "d" | "win" | "rel">): MatchRow => {
    const d = r.a.score - r.b.score;
    return {
      ...r,
      d,
      win: d < 0 ? "a" : d > 0 ? "b" : "tie",
      rel: Math.abs(d) / Math.min(r.a.score, r.b.score),
    };
  };
  const bMaps = new Map(B.workshop.finishes.map((f) => [f.name, f]));
  for (const a of A.workshop.finishes) {
    const b = bMaps.get(a.name);
    if (b)
      rows.push(
        pair({
          scope: "workshop",
          name: a.name,
          title: a.display,
          preview: a.preview,
          field: a.field,
          a,
          b,
        }),
      );
  }
  const bTracks = new Map(
    B.seasons
      .flatMap((s) => s.tiers.flatMap((t) => t.tracks))
      .flatMap((t) => (t.finish ? [[t.name, t.finish] as const] : [])),
  );
  for (const s of A.seasons)
    for (const t of s.tiers.flatMap((x) => x.tracks)) {
      const b = t.finish && bTracks.get(t.name);
      if (t.finish && b)
        rows.push(
          pair({
            scope: "circuit",
            name: t.name,
            title: seasonTag(s.group) + " " + t.display,
            field: t.field,
            a: t.finish,
            b,
          }),
        );
    }
  const wins = (keep: (r: MatchRow) => boolean): Tally => {
    const xs = rows.filter(keep);
    return {
      n: xs.length,
      a: xs.filter((r) => r.win === "a").length,
      b: xs.filter((r) => r.win === "b").length,
    };
  };
  /* the newest season on the Circuit leads the list; a rank is better low, a count high */
  const cur = A.seasons.at(0);
  const stat = (label: string, a: number | null, b: number | null, low = false): BandStat => ({
    label,
    a,
    b,
    rank: low,
    win: a == null || b == null || a === b ? null : (low ? a < b : a > b) ? "a" : "b",
  });
  const rankIn = (rec: PlayerRecord, season: string) =>
    rec.seasons.find((x) => x.group === season)?.overall?.rank ?? null;
  const wrs = (rec: PlayerRecord) => rec.medals.gold + rec.workshop.medals.wr;
  return {
    rows,
    tally: {
      all: wins(() => true),
      circuit: wins((r) => r.scope === "circuit"),
      workshop: wins((r) => r.scope === "workshop"),
    },
    band: [
      stat("All seasons", A.allSeasons?.rank ?? null, B.allSeasons?.rank ?? null, true),
      ...(cur
        ? [stat(cur.group + " overall", rankIn(A, cur.group), rankIn(B, cur.group), true)]
        : []),
      stat("World records", wrs(A), wrs(B)),
      stat("Workshop maps finished", A.workshop.finishes.length, B.workshop.finishes.length),
      stat("Maps made", A.made.length, B.made.length),
    ],
  };
}
