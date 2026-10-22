// What a page's share image says (docs/site.md, "Share images"): the link-preview card a
// player, a Map, a Circuit Track, a Daily or a Campaign unfurls with in Discord and
// elsewhere. Pure, so the rules a card follows are tested here; components/share draws a
// ShareCard and app/og serves it. The design was settled in grill-design (spec #179,
// prototype branch claude/prototype-og; the Campaign's in spec #206).
import type { Campaign } from "./campaigns";
import type { CircuitBoard } from "./circuit";
import { TRACKS } from "./circuit";
import { dayLabel } from "./daily";
import type { PlayerRecord } from "./player";
import type { BoardRow, DailyDay, WorkshopMap } from "./rows";
import { fmtN, fmtSec, fmtTime, hueFor, personaOf, timeMedal } from "./rules";

export const SHARE_KINDS = ["player", "map", "track", "daily", "campaign"] as const;
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
     always four, a Campaign's three */
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

/* What a player has, counted as their cards count it: every count adds the Circuit's Tracks
   and the Workshop's Maps together. A world record is rank 1 on either, a Medal what each
   finish's time earned (so an Author medal includes a world record at the author time), and
   a Map finished any board with a time on it. The share card and the Stat Card both read it. */
export function playerCounts(rec: PlayerRecord) {
  const ws = rec.workshop;
  const run = rec.seasons.flatMap((s) => s.tiers.flatMap((t) => t.tracks));
  const earned = (k: "author" | "gold" | "silver" | "bronze") =>
    run.filter((t) => t.finish?.earned === k).length +
    ws.finishes.filter((f) => f.earned === k).length;
  return {
    wr: rec.medals.gold + ws.medals.wr,
    author: earned("author"),
    gold: earned("gold"),
    silver: earned("silver"),
    bronze: earned("bronze"),
    finished: rec.run + ws.finishes.length,
    made: rec.made.length,
  };
}

/* A player's card: their counts (playerCounts), a zero left out. */
export function playerCard(rec: PlayerRecord): ShareCard {
  const n = playerCounts(rec);
  const s2 = rec.seasons.find((s) => s.group === "Season 2")?.overall;
  const counts: Array<[number, string, Tone?]> = [
    [n.wr, "World records", "gold"],
    [n.author, "Author medals", "author"],
    [n.finished, "Maps finished"],
    [n.made, "Maps made"],
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

/* what a Campaign's card reads, besides the Campaign itself */
export interface CampaignStanding {
  /* its board's field: the players with a time on one of those Maps */
  players: number;
  /* rank 1 on its board */
  leader: BoardRow | null;
  /* how many players hold a time on every one of its Maps the Workshop lists */
  finishedEveryMap: number;
}

/* A Campaign's card: who leads and with how many points, then Maps (all of them, as they
   are numbered), Players and how many finished every Map */
export function campaignCard(c: Campaign, s: CampaignStanding): ShareCard {
  return {
    kind: "campaign",
    kicker: "Campaign · by " + c.creator,
    title: c.title,
    headline: s.leader
      ? {
          value: personaOf(s.leader),
          label: `leads with ${fmtN(s.leader.score)} pts`,
          tone: "gold",
        }
      : { value: "—", label: "No times yet" },
    tiles: [
      { value: fmtN(c.maps.length), label: "Maps" },
      players(s.players),
      { value: fmtN(s.finishedEveryMap), label: "Finished every map", tone: "author" },
    ],
    hue: hueFor(c.slug),
  };
}
