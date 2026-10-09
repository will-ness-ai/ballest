// What a page's share image says (docs/site.md, "Share images"): the link-preview card a
// player, a Map, a Circuit Track or a Daily unfurls with in Discord and elsewhere. Pure, so
// the rules a card follows are tested here; components/share draws a ShareCard and
// app/og serves it. The design was settled in grill-design (spec #179, prototype branch
// claude/prototype-og).
import type { CircuitBoard } from "./circuit";
import { TRACKS } from "./circuit";
import { dayLabel } from "./daily";
import type { PlayerRecord } from "./player";
import type { BoardRow, DailyDay, WorkshopMap } from "./rows";
import { fmtN, fmtSec, fmtTime, hueFor, personaOf, timeMedal } from "./rules";

export const SHARE_KINDS = ["player", "map", "track", "daily"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export const isShareKind = (k: string): k is ShareKind => SHARE_KINDS.some((x) => x === k);

/* the theme colour a number is set in */
export type Tone = "gold" | "author";

export interface ShareStat {
  value: string;
  label: string;
  tone?: Tone;
}

export interface ShareCard {
  kind: ShareKind;
  /* the small line above the title */
  kicker: string;
  title: string;
  /* the line under the title: a rank or a record, and what it is; a player outside
     Season 2's Overall board has none */
  headline: ShareStat | null;
  /* a player's tiles leave out a count of zero, so there are one to four; a place's are
     always four */
  tiles: Array<ShareStat>;
  /* the marble's hue, for a player */
  hue: number;
}

/* "Today", "3d ago", "4w ago", "5mo ago": a Map's age, short enough for a tile */
export function shortAge(created: number, now: number) {
  const d = Math.floor((now / 1000 - created) / 86400);
  if (d < 1) return "Today";
  if (d < 14) return `${String(d)}d ago`;
  if (d < 60) return `${String(Math.floor(d / 7))}w ago`;
  return `${String(Math.round(d / 30))}mo ago`;
}

/* how many of a board's scores are at or under its author time, by the Medal rule */
export const beatAuthor = (scores: ReadonlyArray<number>, medals: ReadonlyArray<number>) =>
  scores.filter((s) => timeMedal(medals, s) === "author").length;

/* A player's card. Every count adds the Circuit's Tracks and the Workshop's Maps together:
   a world record is rank 1 on either, an Author medal any time at or under the author
   time (a world record that beats it included), and a Map finished any board with a time
   on it. A count of zero is left out. */
export function playerCard(rec: PlayerRecord): ShareCard {
  const ws = rec.workshop;
  const run = rec.seasons.flatMap((s) => s.tiers.flatMap((t) => t.tracks));
  const trackAuthors = run.filter((t) => t.finish?.earned === "author").length;
  const s2 = rec.seasons.find((s) => s.group === "Season 2")?.overall;
  const counts: Array<[number, string, Tone?]> = [
    [rec.medals.gold + ws.medals.wr, "World records", "gold"],
    [
      trackAuthors + ws.finishes.filter((f) => f.earned === "author").length,
      "Author medals",
      "author",
    ],
    [rec.run + ws.finishes.length, "Maps finished"],
    [rec.made.length, "Maps made"],
  ];
  return {
    kind: "player",
    kicker: "Player",
    title: personaOf(rec.who),
    headline: s2 ? { value: "#" + fmtN(s2.rank), label: "Season 2 Overall", tone: "gold" } : null,
    tiles: counts
      .filter(([n]) => n > 0)
      .map(([n, label, tone]) => ({ value: fmtN(n), label, ...(tone ? { tone } : {}) })),
    hue: hueFor(rec.id),
  };
}

const record = (wr: { score: number; who: string } | null, label: string): ShareStat =>
  wr
    ? { value: fmtTime(wr.score), label: `${label} · ${wr.who}`, tone: "gold" }
    : { value: "—", label: "No times yet" };

const players = (n: number): ShareStat => ({ value: fmtN(n), label: "Players" });
const authorTime = (medals: ReadonlyArray<number>): ShareStat => ({
  value: medals[3] ? fmtSec(medals[3]) : "—",
  label: "Author time",
  tone: "author",
});
const beat = (n: number): ShareStat => ({
  value: fmtN(n),
  label: "Beat the author",
  tone: "author",
});
const goldTime = (medals: ReadonlyArray<number>): ShareStat => ({
  value: medals[2] ? fmtSec(medals[2]) : "—",
  label: "Gold time",
  tone: "gold",
});

/* A Workshop Map's card: its record, then Players, Author time, Beat the author and how
   long ago it was published */
export function mapCard(m: WorkshopMap, now: number): ShareCard {
  const wr = m.top3.at(0);
  return {
    kind: "map",
    kicker: "Workshop map · by " + m.creator,
    title: m.title,
    headline: record(wr ? { score: wr[2], who: wr[1] } : null, "World record"),
    tiles: [
      players(m.entryCount),
      authorTime(m.medals),
      beat(m.authorBeaten),
      { value: shortAge(m.created, now), label: "Published" },
    ],
    hue: hueFor(m.pfid),
  };
}

/* the top of a board a place card reads: its count, its rank-1 row and every score */
export interface BoardTop {
  total: number;
  first: BoardRow | null;
  scores: ReadonlyArray<number>;
}

const holder = (top: BoardTop) =>
  top.first ? { score: top.first.score, who: personaOf(top.first) } : null;

/* a board with a card of its own: a Track, whose Medal times are known; an Overall board
   keeps the site's picture */
export const hasTrackCard = (b: CircuitBoard) => b.name in TRACKS;

/* A Circuit Track's card: its record, then Players, Author time, Beat the author and the
   Gold time, from the Track's in-game Medal times */
export function trackCard(b: CircuitBoard, top: BoardTop): ShareCard | null {
  if (!hasTrackCard(b)) return null;
  const medals = TRACKS[b.name].medals;
  return {
    kind: "track",
    kicker: `${b.group} · Circuit track`,
    title: b.display,
    headline: record(holder(top), "World record"),
    tiles: [
      players(top.total),
      authorTime(medals),
      beat(beatAuthor(top.scores, medals)),
      goldTime(medals),
    ],
    hue: hueFor(b.name),
  };
}

/* A Daily's card: the day's fastest time, live or final alike (no live state, by Will's
   verdict), then Players, Author time, Beat the author and the Gold time */
export function dailyCard(d: DailyDay, top: BoardTop): ShareCard {
  return {
    kind: "daily",
    kicker: "Daily · " + dayLabel(d.date, true),
    title: d.title,
    headline: record(holder(top), "Fastest"),
    tiles: [
      players(top.total),
      authorTime(d.medals),
      beat(beatAuthor(top.scores, d.medals)),
      goldTime(d.medals),
    ],
    hue: hueFor(d.pfid),
  };
}
