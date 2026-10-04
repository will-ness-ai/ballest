// The Daily Report (spec #126) as plain data: what the database holds (ReportData, read by
// source.ts) in, the standings, the lists and what changed since yesterday out. Pure, so every
// rule here is tested without Postgres, Steam or Discord.
import { SCORE_TICKS_PER_SECOND } from "../domain.js";

export const DAY_MS = 86_400_000;
/** A creator's own time must beat their Author Medal by this much to count (1 ms). */
export const CREATOR_BEAT_MARGIN = SCORE_TICKS_PER_SECOND / 1000;
/** Rows on each of the four boards. */
export const TOP = 10;

/** A Workshop Map as the report needs it. */
export interface ReportMap {
  readonly pfid: string;
  readonly board: string;
  readonly title: string;
  /** The creator's Steam ID; their own Entries count only by beating the Author Medal. */
  readonly creator: string | null;
  /** When it was published (ms), or null if the database doesn't know. */
  readonly createdAt: number | null;
  /** The Author Medal in ticks, or null for a Map that publishes no Medals. */
  readonly authorTicks: number | null;
  /**
   * When the collector first read its board (ms), or null if never. Before that the database
   * knows nothing of it, so a board first read in the last day has no yesterday to compare with.
   */
  readonly firstReadAt: number | null;
}

/** An Entry on a Map's board that was open at the report's time or 24 hours before it. */
export interface ReportEntry {
  readonly board: string;
  readonly steamId: string;
  readonly persona: string;
  readonly score: number;
  readonly ugcId: string | null;
  /** When the Refresh that first saw it started (ms). */
  readonly firstSeenAt: number;
  /** When the Refresh that closed it started (ms), or null while it is open. */
  readonly closedAt: number | null;
}

/** A Track's world record at one moment. */
export interface TrackRecord {
  readonly steamId: string;
  readonly persona: string;
  readonly score: number;
  readonly ugcId: string | null;
}

export interface ReportTrack {
  readonly board: string;
  /** "S2 04 Big Stairs": the Season leads, since Tracks are numbered per Season. */
  readonly label: string;
  readonly record: TrackRecord | null;
  readonly recordYesterday: TrackRecord | null;
}

export interface ReportData {
  readonly maps: ReadonlyArray<ReportMap>;
  readonly entries: ReadonlyArray<ReportEntry>;
  /** The Tracks in their order on the site. */
  readonly tracks: ReadonlyArray<ReportTrack>;
  /** When the last Refresh that wrote the database finished (ms), or null with none yet. */
  readonly refreshedAt: number | null;
}

// ---------------------------------------------------------------- the report

export type Stat = "played" | "author" | "wr" | "top5";
export interface Standing {
  readonly steamId: string;
  readonly persona: string;
  readonly n: number;
}
export interface Board {
  readonly stat: Stat;
  readonly rows: ReadonlyArray<Standing>;
}

export interface ListedMap {
  readonly pfid: string;
  readonly title: string;
  /** Players who count on it (see `counted`). */
  readonly finishers: number;
}

/** Something that changed in the last 24 hours, in the order the report lists them. */
export type Change =
  | {
      readonly kind: "trackRecord";
      readonly track: string;
      readonly by: string;
      readonly from: string;
      readonly score: number;
      readonly gain: number;
    }
  | {
      readonly kind: "mapRecord";
      readonly map: ListedMap;
      readonly players: number;
      readonly by: string;
      readonly from: string;
      readonly score: number;
    }
  | {
      readonly kind: "firstFinish";
      readonly map: ListedMap;
      readonly players: number;
      readonly by: string;
    }
  | {
      readonly kind: "firstAuthor";
      readonly map: ListedMap;
      readonly players: number;
      readonly by: string;
    };

/** A world record that may be among the longest-standing, once its ghost dates it. */
export interface RecordCandidate {
  readonly steamId: string;
  readonly persona: string;
  readonly score: number;
  readonly ugcId: string;
  /** A Track's label, or the Map. */
  readonly where: { readonly track: string } | { readonly map: ListedMap };
  /** For a Map, when it was published (ms): the walk in records.ts goes oldest Map first. */
  readonly publishedAt: number | null;
}

export interface Report {
  readonly at: number;
  /** The data's age: when the last Refresh finished (ms), or null with none yet. */
  readonly refreshedAt: number | null;
  readonly maps: number;
  readonly players: number;
  readonly boards: ReadonlyArray<Board>;
  readonly unfinished: ReadonlyArray<ListedMap>;
  readonly unclaimed: ReadonlyArray<ListedMap>;
  readonly changes: ReadonlyArray<Change>;
  readonly newMaps: number;
  readonly trackRecords: ReadonlyArray<RecordCandidate>;
  readonly mapRecords: ReadonlyArray<RecordCandidate>;
}

const openAt = (e: ReportEntry, t: number) =>
  e.firstSeenAt <= t && (e.closedAt === null || e.closedAt > t);

const bySteamId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Rank order on a time board: fastest, then first seen, then Steam ID (as web/db/reads.ts). */
const byRank = (a: ReportEntry, b: ReportEntry) =>
  a.score - b.score || a.firstSeenAt - b.firstSeenAt || bySteamId(a.steamId, b.steamId);

/**
 * The Entries on a Map that count, in rank order. A creator's own Entry counts only if it beats
 * the Author Medal by CREATOR_BEAT_MARGIN: the Author time is their publishing run, so matching
 * it is not a finish. Positions (world record, top 5) are counted among these.
 */
export const counted = (map: ReportMap, entries: ReadonlyArray<ReportEntry>) =>
  [...entries]
    .sort(byRank)
    .filter(
      (e) =>
        e.steamId !== map.creator ||
        map.authorTicks === null ||
        e.score <= map.authorTicks - CREATOR_BEAT_MARGIN,
    );

const medalled = (map: ReportMap, e: ReportEntry) =>
  map.authorTicks !== null && e.score <= map.authorTicks;

const STATS: ReadonlyArray<{ stat: Stat; then?: Stat }> = [
  { stat: "played" },
  { stat: "author" },
  { stat: "wr", then: "top5" },
  { stat: "top5", then: "wr" },
];

/** Workshop changes listed before "and N more", busiest Map first. */
export const CHANGES_SHOWN = 6;

export const buildReport = (data: ReportData, at: number): Report => {
  const yesterday = at - DAY_MS;
  const byBoard = new Map<string, Array<ReportEntry>>();
  for (const e of data.entries) {
    const list = byBoard.get(e.board) ?? [];
    list.push(e);
    byBoard.set(e.board, list);
  }

  const tally = new Map<string, Record<Stat, number> & { persona: string }>();
  const unfinished: Array<ListedMap> = [];
  const unclaimed: Array<ListedMap> = [];
  const mapChanges: Array<Extract<Change, { map: ListedMap }>> = [];
  const mapRecords: Array<RecordCandidate> = [];
  let newMaps = 0;

  for (const map of data.maps) {
    const all = byBoard.get(map.board) ?? [];
    const open = all.filter((e) => e.closedAt === null);
    const now = counted(map, open);
    const before = counted(
      map,
      all.filter((e) => openAt(e, yesterday)),
    );
    const listed: ListedMap = { pfid: map.pfid, title: map.title, finishers: now.length };
    now.forEach((e, i) => {
      const t = tally.get(e.steamId) ?? {
        played: 0,
        author: 0,
        wr: 0,
        top5: 0,
        persona: e.persona,
      };
      t.persona = e.persona;
      t.played += 1;
      if (medalled(map, e)) t.author += 1;
      if (i === 0) t.wr += 1;
      if (i < 5) t.top5 += 1;
      tally.set(e.steamId, t);
    });

    // Maps up less than a day aren't listed or reported on: they haven't been played yet.
    const dayOld = map.createdAt === null || map.createdAt <= yesterday;
    if (!dayOld) newMaps += 1;
    const medals = now.filter((e) => medalled(map, e));
    if (dayOld && now.length === 0) unfinished.push(listed);
    if (dayOld && now.length > 0 && map.authorTicks !== null && medals.length === 0)
      unclaimed.push(listed);

    const record = now[0];
    if (record !== undefined && record.ugcId !== null)
      mapRecords.push({
        steamId: record.steamId,
        persona: record.persona,
        score: record.score,
        ugcId: record.ugcId,
        where: { map: listed },
        publishedAt: map.createdAt,
      });

    const readYesterday = map.firstReadAt !== null && map.firstReadAt <= yesterday;
    if (!dayOld || !readYesterday || record === undefined) continue;
    const players = open.length;
    const held = before[0];
    if (held === undefined) {
      mapChanges.push({ kind: "firstFinish", map: listed, players, by: record.persona });
    } else if (held.steamId !== record.steamId) {
      mapChanges.push({
        kind: "mapRecord",
        map: listed,
        players,
        by: record.persona,
        from: held.persona,
        score: record.score,
      });
    }
    const firstMedal = medals[0];
    if (
      firstMedal !== undefined &&
      map.authorTicks !== null &&
      !before.some((e) => medalled(map, e))
    )
      mapChanges.push({ kind: "firstAuthor", map: listed, players, by: firstMedal.persona });
  }

  const ranked = (stat: Stat, then?: Stat): ReadonlyArray<Standing> =>
    [...tally.entries()]
      .filter(([, t]) => t[stat] > 0)
      .sort(
        ([a, t], [b, u]) => u[stat] - t[stat] || (then ? u[then] - t[then] : 0) || bySteamId(a, b),
      )
      .slice(0, TOP)
      .map(([steamId, t]) => ({ steamId, persona: t.persona, n: t[stat] }));

  const trackChanges: Array<Change> = [];
  const trackRecords: Array<RecordCandidate> = [];
  for (const track of data.tracks) {
    const now = track.record;
    const then = track.recordYesterday;
    if (now !== null && then !== null && now.steamId !== then.steamId)
      trackChanges.push({
        kind: "trackRecord",
        track: track.label,
        by: now.persona,
        from: then.persona,
        score: now.score,
        gain: then.score - now.score,
      });
    if (now !== null && now.ugcId !== null)
      trackRecords.push({
        steamId: now.steamId,
        persona: now.persona,
        score: now.score,
        ugcId: now.ugcId,
        where: { track: track.label },
        publishedAt: null,
      });
  }

  const title = (m: ListedMap) => m.title.toLowerCase();
  return {
    at,
    refreshedAt: data.refreshedAt,
    maps: data.maps.length,
    players: tally.size,
    boards: STATS.map(({ stat, then }) => ({ stat, rows: ranked(stat, then) })),
    unfinished: unfinished.sort((a, b) => title(a).localeCompare(title(b))),
    unclaimed: unclaimed.sort(
      (a, b) => b.finishers - a.finishers || title(a).localeCompare(title(b)),
    ),
    // The Circuit first, then the Workshop's busiest Maps; a stable sort keeps a Map's own
    // changes in the order they were found.
    changes: [...trackChanges, ...mapChanges.sort((a, b) => b.players - a.players)],
    newMaps,
    trackRecords,
    mapRecords,
  };
};
