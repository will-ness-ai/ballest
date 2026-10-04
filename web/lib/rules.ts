// The page's invariants and formatting, in one place every view and the read layer share.
// Each rule here used to live in the old single-file page's script; the reasons stay with
// them.

export const SITE_TITLE = "Ballest of Them All";
/* a page's title in the tab: its own name, then the site's (the layout's title template) */
export const pageTitle = (title: string) => title + " · " + SITE_TITLE;

/* Track and Map boards store a run time as hundred-thousandths of a second, NOT
   milliseconds: seconds = score / 100000. Verified against the Medal times each Workshop
   Map publishes and against board shape (Map_Track13's leader is 0:10.267, not 17:06).
   Overall boards are points and never come through fmtTime. The same constant is
   SCORE_TICKS_PER_SECOND in tools/campaign_common.py. */
export const SCORE_TICKS_PER_SECOND = 100000;

/* An aggregate board is points, higher is better; a Track or Map board is a run time.
   Read from the name prefix alone, as the collector's board_kind is: renaming an Overall
   board, or adding an aggregate board not named Overall*, would render points as a time. */
export const isPoints = (boardName: string) => boardName.startsWith("Overall");

/* Every ID the collector writes is a Steam64, but one reaches us from the URL too, so
   anything that becomes a link, a query or a selector is checked against this first. */
export const STEAM_ID = /\d{5,25}/;
const IS_STEAM_ID = new RegExp("^" + STEAM_ID.source + "$");
export const isSteamId = (id: unknown): id is string =>
  typeof id === "string" && IS_STEAM_ID.test(id);

/* the one place that reads a Map's board name: Workshop_<pfid>, or null for a Circuit board */
export const MAP_PREFIX = "Workshop_";
export const mapPfidOf = (name: string | null | undefined) =>
  name?.startsWith(MAP_PREFIX) ? name.slice(MAP_PREFIX.length) : null;

export const fmtN = (n: number) => n.toLocaleString("en-US");

const SUFFIX: Partial<Record<number, string>> = { 1: "st", 2: "nd", 3: "rd" };
export const ord = (n: number) =>
  String(n) + (SUFFIX[((n % 100) - 20) % 10] ?? SUFFIX[n % 100] ?? "th");

export const plural = (n: number, one: string, many: string) =>
  fmtN(n) + " " + (n === 1 ? one : many);

export const personaOf = (r: { persona?: string | null; steamId: string }) =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty name too
  r.persona || "Player " + r.steamId.slice(-6);

export function fmtTime(score: number) {
  const ms = Math.floor((Math.abs(score) * 1000) / SCORE_TICKS_PER_SECOND);
  const h = Math.floor(ms / 3600000),
    m = Math.floor((ms % 3600000) / 60000),
    s = Math.floor((ms % 60000) / 1000),
    x = ms % 1000;
  return (
    (h ? String(h) + ":" : "") +
    String(m).padStart(h ? 2 : 1, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "." +
    String(x).padStart(3, "0")
  );
}

/* a score in the board's own unit: points on an Overall board, else a time */
export const value = (boardName: string, n: number) => (isPoints(boardName) ? fmtN(n) : fmtTime(n));

/* a Medal time, which Maps publish in seconds */
export const fmtSec = (s: number) => fmtTime(Math.round(s * SCORE_TICKS_PER_SECOND));
export const secs = (ticks: number) => (ticks / SCORE_TICKS_PER_SECOND).toFixed(3) + "s";

/* under a minute the leading "0:0" of a gap is noise */
export function shortGap(ticks: number) {
  const s = ticks / SCORE_TICKS_PER_SECOND;
  return "+" + (s < 60 ? s.toFixed(3) : fmtTime(ticks));
}

export function relTime(dt: Date, now = Date.now()) {
  const s = Math.round((now - dt.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return String(m) + (m === 1 ? " minute ago" : " minutes ago");
  const h = Math.round(m / 60);
  if (h < 24) return String(h) + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return String(d) + (d === 1 ? " day ago" : " days ago");
}

/* What one Track pays toward Overall for a place: 1st pays POINTS_FIRST, 10th a tenth of
   it, then it halves at every 10x in place. The game's own rule, as the collector rebuilt
   Season 1's current board with it (track_points in tools/campaign_common.py); if the
   game rescales, both change. trackPointsSql in db/boards.ts is the same rule in SQL. */
export const POINTS_FIRST = 40000;
export function trackPoints(place: number) {
  if (place <= 10) return Math.floor(POINTS_FIRST / place);
  const k = String(place - 1).length - 1; /* place is in (10^k, 10^(k+1)] */
  return Math.floor((POINTS_FIRST * 9) / 100 / 2 ** k + (POINTS_FIRST * 5 ** k) / 10 / place);
}

/* A marble's colour, from the Steam ID: the leaderboard API doesn't say which ball a player raced */
export function hueFor(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/* The six Medals a Workshop finish can show, best first. A world record is rank 1 on the
   Map's board, and counts there alone, not again under the Medal its time earns. */
export const TIERS = [
  ["wr", "World record"],
  ["author", "Author"],
  ["gold", "Gold"],
  ["silver", "Silver"],
  ["bronze", "Bronze"],
  ["none", "No medal"],
] as const;
export type Tier = (typeof TIERS)[number][0];
export const TIER_LABEL = Object.fromEntries(TIERS) as Record<Tier, string>;

/* the one place that rule lives. A Map's Medals are [bronze, silver, gold, author], seconds */
export function tierOf(medals: ReadonlyArray<number>, rank: number, score: number): Tier {
  if (rank === 1) return "wr";
  const at = (i: number) => score <= (medals[i] ?? 0) * SCORE_TICKS_PER_SECOND;
  return at(3) ? "author" : at(2) ? "gold" : at(1) ? "silver" : at(0) ? "bronze" : "none";
}

/* where a run sits in its field. Inside the first percent it reads "top 0.1%" at worst:
   a rounded "top 0.0%" would claim a share that cannot exist. */
export function pctOf(rank: number, field: number) {
  const x = (rank / field) * 100;
  return (
    "top " +
    (x < 1 ? Math.max(0.1, Math.round(x * 10) / 10).toFixed(1) : String(Math.ceil(x))) +
    "%"
  );
}

/* "Season 2" -> "S2", so a Track reads "S2 07" beside a Map's title */
export const seasonTag = (g: string) => {
  const n = /\d+/.exec(g);
  return n ? "S" + n[0] : g;
};

/* how long ago a Map was published, from its created time in Unix seconds */
export const ageDays = (created: number, now = Date.now()) => (now / 1000 - created) / 86400;
export function ageText(created: number, now = Date.now()) {
  const d = Math.floor(ageDays(created, now));
  return d < 1
    ? "today"
    : d === 1
      ? "yesterday"
      : d < 60
        ? String(d) + " days ago"
        : String(Math.round(d / 30)) + " months ago";
}

/* preview pictures come from Steam's CDN; anything that isn't plain https is dropped */
export const safeImg = (u: string | null | undefined) => (u?.startsWith("https://") ? u : "");
/* the link out to a Steam profile, likewise only plain http(s) */
export const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : "");

/* each Medal's name, colour and index into a [bronze, silver, gold, author] list, best first */
export const MEDALS = [
  ["Author", "var(--author)", 3],
  ["Gold", "var(--gold)", 2],
  ["Silver", "var(--silver)", 1],
  ["Bronze", "var(--bronze)", 0],
] as const;
