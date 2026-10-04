// The Workshop's three views share these: what a Map card carries, the sorts and the
// figure each shows, the Refine panel's filters, All maps' ready-made views, the
// homepage's shelves and carousel picks, and the Maps kept off the homepage. Pure, so the
// server pages, the client views and the /api/maps search all use one copy. Anything that
// reads the clock takes `now`, so a cached page never freezes it (hooks/client.ts useNow).
import type { WorkshopMap } from "./rows";
import { SCORE_TICKS_PER_SECOND, ageDays, ageText, fmtN, fmtSec, plural, secs } from "./rules";

/* what a card, the carousel and All maps need of a Map; the rest of WorkshopMap stays on
   the server */
export interface MapCard {
  pfid: string;
  title: string;
  creator: string;
  cid: string | null;
  preview: string | null;
  /* published, Unix seconds */
  created: number;
  /* the author Medal, seconds */
  author: number;
  entryCount: number;
  sessions: number;
  top3: Array<[string, string, number]>;
  gap13: number | null;
  crowd: number;
  authorBeaten: number;
}

export const mapCard = (m: WorkshopMap): MapCard => ({
  pfid: m.pfid,
  title: m.title,
  creator: m.creator,
  cid: m.cid,
  preview: m.preview,
  created: m.created,
  author: m.medals[3] ?? 0,
  entryCount: m.entryCount,
  sessions: m.sessions,
  top3: m.top3,
  gap13: m.gap13,
  crowd: m.crowd,
  authorBeaten: m.authorBeaten,
});

/* the Maps the Workshop views show: those with a time. A Map nobody has finished has no
   board, so it shows only on its creator's Made tab */
export const timed = <T extends { top3: ReadonlyArray<unknown> }>(maps: ReadonlyArray<T>) =>
  maps.filter((m) => m.top3.length > 0);

export const recordOf = (m: MapCard) => m.top3[0][2];
/* how far the record is under the author time, in ticks; negative when it is slower */
const underAuthor = (m: MapCard) => m.author * SCORE_TICKS_PER_SECOND - recordOf(m);
const unbeaten = (m: MapCard) => m.authorBeaten === 0;
const gapOrLast = (m: MapCard) => m.gap13 ?? Infinity;
const runsStat = (m: MapCard) => plural(m.entryCount, "run", "runs");

/* Each sort carries the number a card shows while it is on: a shelf, or All maps sorted
   that way, shows the figure its order is about. */
export interface Sort {
  label: string;
  cmp: (a: MapCard, b: MapCard) => number;
  stat: (m: MapCard, now: number) => string;
}
const SORT_DEFS = {
  runs: { label: "Most runs", cmp: (a, b) => b.entryCount - a.entryCount, stat: runsStat },
  fewest: {
    label: "Fewest runs",
    cmp: (a, b) => a.entryCount - b.entryCount || a.created - b.created,
    stat: runsStat,
  },
  new: {
    label: "Newest",
    cmp: (a, b) => b.created - a.created,
    stat: (m, now) => ageText(m.created, now),
  },
  plays: {
    label: "Most played",
    cmp: (a, b) => b.sessions - a.sessions,
    stat: (m) => plural(m.sessions, "play", "plays"),
  },
  short: {
    label: "Shortest",
    cmp: (a, b) => a.author - b.author,
    stat: (m) => "author " + fmtSec(m.author),
  },
  tight: {
    label: "Tightest top three",
    cmp: (a, b) => gapOrLast(a) - gapOrLast(b),
    stat: (m) => (m.gap13 == null ? "under 3 runs" : "1st to 3rd " + secs(m.gap13)),
  },
  crowd: {
    label: "Most crowded",
    cmp: (a, b) => b.crowd - a.crowd,
    stat: (m) => fmtN(m.crowd) + " within 1s",
  },
  under: {
    label: "Author time crushed",
    cmp: (a, b) => underAuthor(b) / b.author - underAuthor(a) / a.author,
    stat: (m) => (underAuthor(m) > 0 ? secs(underAuthor(m)) + " under" : "not beaten"),
  },
} satisfies Record<string, Sort>;
export type SortKey = keyof typeof SORT_DEFS;
export const SORTS: Record<SortKey, Sort> = SORT_DEFS;

type Keep = (m: MapCard, now: number) => boolean;
export const FILTERS = {
  len: {
    label: "Length",
    any: "Any length",
    opts: {
      short: ["Under 15s", (m) => m.author < 15],
      mid: ["15 to 40s", (m) => m.author >= 15 && m.author < 40],
      long: ["40s and up", (m) => m.author >= 40],
    },
  },
  age: {
    label: "Published",
    any: "Any time",
    opts: {
      week: ["This week", (m, now) => ageDays(m.created, now) <= 7],
      month: ["This month", (m, now) => ageDays(m.created, now) <= 30],
      older: ["Over a month ago", (m, now) => ageDays(m.created, now) > 30],
    },
  },
  author: {
    label: "Author time",
    any: "Beaten or not",
    opts: {
      unbeaten: ["Unbeaten", unbeaten],
      beaten: ["Beaten", (m) => !unbeaten(m)],
    },
  },
  runs: {
    label: "Runs",
    any: "Any number",
    opts: {
      few: ["Under 10", (m) => m.entryCount < 10],
      some: ["10 to 99", (m) => m.entryCount >= 10 && m.entryCount < 100],
      many: ["100 or more", (m) => m.entryCount >= 100],
    },
  },
} satisfies Record<
  string,
  { label: string; any: string; opts: Record<string, readonly [string, Keep]> }
>;
export type FilterKey = keyof typeof FILTERS;
export const FILTER_KEYS = Object.keys(FILTERS) as Array<FilterKey>;

/* the Refine panel's state: each filter's option ("any" for none) and the sort */
export type Refine = Record<FilterKey, string> & { sort: SortKey };
export const NO_FILTER = (): Refine => ({
  len: "any",
  age: "any",
  author: "any",
  runs: "any",
  sort: "runs",
});

/* All maps' tabs, and the presets a shelf's See all opens; each is a link, /maps/<key> */
export const VIEWS: ReadonlyArray<readonly [string, string, Partial<Refine>]> = [
  ["all", "All", {}],
  ["unbeaten", "Unbeaten", { author: "unbeaten" }],
  ["new", "New this week", { age: "week", sort: "new" }],
  ["short", "Under 15s", { len: "short" }],
  ["tight", "Tight racing", { sort: "tight" }],
  ["plays", "Most played", { sort: "plays" }],
];
export const PRESETS: Record<string, Partial<Refine>> = {
  ...Object.fromEntries(VIEWS.map(([k, , f]) => [k, f])),
  crowd: { sort: "crowd" },
  under: { sort: "under" },
  quiet: { sort: "fewest" },
};
export const refineFor = (view: string | null): Refine => ({
  ...NO_FILTER(),
  ...(view ? PRESETS[view] : {}),
});
export const sameRefine = (a: Refine, b: Refine) =>
  (Object.keys(a) as Array<keyof Refine>).every((k) => a[k] === b[k]);

const optKeep = (k: FilterKey, v: string): Keep =>
  (FILTERS[k].opts as Record<string, readonly [string, Keep]>)[v][1];
export const activeFilters = (f: Refine) => FILTER_KEYS.filter((k) => f[k] !== "any");
export const filteredMaps = (maps: ReadonlyArray<MapCard>, f: Refine, now: number) => {
  const on = activeFilters(f).map((k) => optKeep(k, f[k]));
  return maps.filter((m) => on.every((keep) => keep(m, now))).sort(SORTS[f.sort].cmp);
};

export const SHELF_SIZE = 12,
  MAPS_CHUNK = 60;

/* the homepage's shelves; `keep` narrows a shelf to the Maps it is about, and `week` to
   those published in the last week, which reads the clock (onShelf) */
export interface Shelf {
  title: string;
  note: string;
  sort: SortKey;
  all: string;
  keep?: (m: MapCard) => boolean;
  week?: true;
}
export const SHELVES: ReadonlyArray<Shelf> = [
  { title: "Most played", note: "by Workshop play sessions", sort: "plays", all: "plays" },
  {
    title: "New this week",
    note: "newest first",
    sort: "new",
    all: "new",
    week: true,
  },
  {
    title: "Unbeaten author time",
    note: "nobody has beaten the creator",
    sort: "runs",
    all: "unbeaten",
    keep: unbeaten,
  },
  {
    title: "Tightest top three",
    note: "1st to 3rd closest together",
    sort: "tight",
    all: "tight",
    keep: (m) => m.gap13 != null,
  },
  {
    title: "Crowded at the top",
    note: "most runs within a second of the record",
    sort: "crowd",
    all: "crowd",
  },
  {
    title: "Author time crushed",
    note: "record furthest under the author time",
    sort: "under",
    all: "under",
  },
  { title: "Barely played", note: "fewest runs so far", sort: "fewest", all: "quiet" },
];

/* Maps kept off the homepage's carousel and shelves, by pfid, with the reason their page
   shows. Players report one through the link on its page; it goes in here by hand. The
   Map stays in All maps, search, and everyone's player page. */
export const HIDDEN: Record<string, string | undefined> = {
  3623648768: "Can't be finished on the current version of the game.",
};

const REPORT_URL = "https://github.com/will-ness-ai/ballest/issues/new";
export const reportHref = (m: { title: string; pfid: string }) =>
  REPORT_URL +
  "?" +
  new URLSearchParams({
    title: `Hide map: ${m.title} (${m.pfid})`,
    body: `Map: https://ballest.willness.dev/map/${m.pfid}\n\nWhat's wrong with it:\n`,
  }).toString();

/* the homepage's Maps: the carousel and every shelf draw from this */
const homeSorted = (maps: ReadonlyArray<MapCard>, sort: SortKey, keep?: (m: MapCard) => boolean) =>
  maps.filter((m) => !HIDDEN[m.pfid] && (!keep || keep(m))).sort(SORTS[sort].cmp);

/* A shelf's Maps, before the week filter: New this week is sorted newest first, so its
   first SHELF_SIZE hold every Map the filter can keep, and onShelf narrows them where the
   clock is read. */
export const shelfMaps = (maps: ReadonlyArray<MapCard>, d: Shelf) =>
  homeSorted(maps, d.sort, d.keep).slice(0, SHELF_SIZE);
export const onShelf = (maps: ReadonlyArray<MapCard>, d: Shelf, now: number) =>
  d.week ? maps.filter((m) => ageDays(m.created, now) <= 7) : maps;

/* five different Maps, each up for a different reason; none depends on the clock */
export interface Pick {
  label: string;
  sort: SortKey;
  m: MapCard;
}
export function picks(maps: ReadonlyArray<MapCard>): Array<Pick> {
  const used = new Set<string>();
  const pick = (label: string, sort: SortKey, keep?: (m: MapCard) => boolean) => {
    const m = homeSorted(maps, sort, (x) => !used.has(x.pfid) && (!keep || keep(x)))[0] as
      MapCard | undefined;
    if (!m) return null;
    used.add(m.pfid);
    return { label, sort, m };
  };
  return [
    pick("Most played", "plays"),
    pick("Newest", "new"),
    pick("Most runs", "runs"),
    pick("Barely played", "fewest"),
    pick("Tightest top three", "tight", (m) => m.gap13 != null),
  ].filter((p) => p !== null);
}
/* why a pick is up, as its eyebrow says */
export const whyOf = (p: Pick, now: number) =>
  p.sort === "new" ? "published " + ageText(p.m.created, now) : SORTS[p.sort].stat(p.m, now);

/* the homepage search: every Map with a time whose title or creator contains q, most runs
   first */
export const searchMaps = (maps: ReadonlyArray<MapCard>, q: string) => {
  const t = q.trim().toLowerCase();
  return maps
    .filter((m) => (m.title + " " + m.creator).toLowerCase().includes(t))
    .sort(SORTS.runs.cmp);
};
