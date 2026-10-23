// The site search (GET /api/search, components/search/): what a query finds among players and
// Map makers, Maps, Campaigns, Circuit Tracks, Dailies and Prefabs, how each hit scores, and
// how the results are grouped under the filter chips. Pure: the route hands it what it read.
import { TRACKS } from "./circuit";
import type { IndexBoard } from "./player";
import type { DailyCell, NameHit } from "./rows";
import {
  boardHref,
  campaignHref,
  dailyHref,
  mapHref,
  mapsSearchHref,
  playerHref,
  prefabHref,
} from "./routes";
import { fmtTime, plural } from "./rules";
import { searchMaps, type MapCard } from "./workshop";

export type SearchKind = "people" | "campaigns" | "maps" | "tracks" | "dailies" | "prefabs";

/* one hit, whatever its kind; `tag` names it on its row (a Maker, a Map), and `who` is the
   player whose marble stands in for a picture */
export interface Hit {
  kind: SearchKind;
  href: string;
  title: string;
  meta: string;
  tag: string;
  img: string | null;
  who: NameHit | null;
  score: number;
}

/* the answer: up to PER_KIND hits of each kind, and how many Maps matched in all */
export interface SearchAnswer {
  q: string;
  hits: Array<Hit>;
  mapTotal: number;
}

/* what the route read for a query: the players whose name matches it (read fresh) and the
   cached lists the rest are found in */
export interface SearchSources {
  players: ReadonlyArray<NameHit>;
  cards: ReadonlyArray<MapCard>;
  /* the listed Campaigns, `maps` their curated count */
  campaigns: ReadonlyArray<{
    slug: string;
    title: string;
    creator: string;
    maps: number;
    players: number;
    preview: string | null;
  }>;
  boards: ReadonlyArray<IndexBoard>;
  /* oldest first, as the calendar reads them */
  dailies: ReadonlyArray<DailyCell>;
  prefabs: ReadonlyArray<{
    slug: string;
    name: string;
    tags: ReadonlyArray<string>;
    pieces: number;
    favorites: number;
    uploader: { name: string };
  }>;
}

/* how well a name matches the query: the whole name, its start, a word's start, anywhere */
function tierOf(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 4;
  if (n.startsWith(q)) return 3;
  if (n.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

/* a hit's score: its tier first, then how much it is played, which only breaks a tie */
const scoreOf = (tier: number, popularity: number) =>
  tier * 100 + Math.min(99, Math.log10(1 + popularity) * 20);

/* players the search found by name, and every maker whose name matches with the Maps they
   made; a maker who is on no board links to their Made tab */
function people(q: string, s: SearchSources): Array<Hit> {
  const made = new Map<string, { name: string; maps: number }>();
  for (const m of s.cards) {
    if (!m.cid) continue;
    const e = made.get(m.cid) ?? { name: m.creator, maps: 0 };
    e.maps++;
    made.set(m.cid, e);
  }
  const found = new Map<string, { who: NameHit; maps: number; plays: boolean }>();
  for (const p of s.players)
    found.set(p.steamId, { who: p, maps: made.get(p.steamId)?.maps ?? 0, plays: true });
  for (const [id, m] of made)
    if (!found.has(id) && tierOf(m.name, q))
      found.set(id, {
        who: { steamId: id, persona: m.name, avatar: null },
        maps: m.maps,
        plays: false,
      });
  return [...found.values()].flatMap(({ who, maps, plays }) => {
    /* found by Steam ID rather than name, it still counts as a match */
    const tier = Math.max(tierOf(who.persona, q), who.steamId.includes(q) ? 1 : 0);
    return tier
      ? [
          {
            kind: "people" as const,
            href: playerHref(who.steamId, plays ? null : "made"),
            title: who.persona,
            meta: [
              plays ? "Player" : null,
              maps ? (plays ? "made " : "Made ") + plural(maps, "Map", "Maps") : null,
            ]
              .filter(Boolean)
              .join(" · "),
            tag: maps ? "Maker" : "Player",
            img: null,
            who,
            score: scoreOf(tier, maps),
          },
        ]
      : [];
  });
}

function maps(q: string, found: ReadonlyArray<MapCard>): Array<Hit> {
  return found.map((m) => ({
    kind: "maps",
    href: mapHref(m.pfid),
    title: m.title,
    meta:
      `by ${m.creator} · ${plural(m.entryCount, "run", "runs")}` +
      (m.top3[0] ? " · record " + fmtTime(m.top3[0][2]) : ""),
    tag: "Map",
    img: m.preview,
    who: null,
    /* a Map found by its maker's name ranks as a contains */
    score: scoreOf(Math.max(tierOf(m.title, q), Math.min(1, tierOf(m.creator, q))), m.entryCount),
  }));
}

function campaigns(q: string, list: SearchSources["campaigns"]): Array<Hit> {
  return list.flatMap((c) => {
    const tier = Math.max(tierOf(c.title, q), tierOf(c.creator, q));
    return tier
      ? [
          {
            kind: "campaigns" as const,
            href: campaignHref(c.slug),
            title: c.title,
            meta: `by ${c.creator} · ${plural(c.maps, "Map", "Maps")} · ${plural(c.players, "player", "players")}`,
            tag: "Campaign",
            img: c.preview,
            who: null,
            score: scoreOf(tier, c.players),
          },
        ]
      : [];
  });
}

/* a Circuit board by its number or nickname ("08", "Downhill"), or its season with it */
function tracks(q: string, boards: SearchSources["boards"]): Array<Hit> {
  return boards.flatMap((b) => {
    const tier = Math.max(tierOf(b.display, q), Math.min(2, tierOf(b.group + " " + b.display, q)));
    return tier
      ? [
          {
            kind: "tracks" as const,
            href: boardHref(b.name),
            title: b.group + " · " + b.display,
            meta: plural(b.entryCount, "player", "players"),
            tag: "Circuit",
            img: b.name in TRACKS ? TRACKS[b.name].img : null,
            who: null,
            score: scoreOf(tier, b.entryCount),
          },
        ]
      : [];
  });
}

/* a Daily by its Map's title or its date; the newest first among equals */
function dailies(q: string, list: SearchSources["dailies"]): Array<Hit> {
  return [...list].reverse().flatMap((d) => {
    const tier = Math.max(tierOf(d.title, q), tierOf(d.date, q));
    return tier
      ? [
          {
            kind: "dailies" as const,
            href: dailyHref(d.date),
            title: d.title,
            meta: d.date + " · " + plural(d.entryCount, "player", "players"),
            tag: "Daily",
            img: d.preview,
            who: null,
            score: scoreOf(tier, d.entryCount),
          },
        ]
      : [];
  });
}

/* a Prefab by its name, or one of its tags, which ranks as a word's start at best */
function prefabs(q: string, list: SearchSources["prefabs"]): Array<Hit> {
  return list.flatMap((p) => {
    const tier = Math.max(tierOf(p.name, q), ...p.tags.map((t) => Math.min(2, tierOf(t, q))));
    return tier
      ? [
          {
            kind: "prefabs" as const,
            href: prefabHref(p.slug),
            title: p.name,
            meta: `by ${p.uploader.name} · ${plural(p.pieces, "piece", "pieces")}`,
            tag: "Prefab",
            img: null,
            who: null,
            score: scoreOf(tier, p.favorites),
          },
        ]
      : [];
  });
}

/* the longest query read; a longer one is cut */
export const SEARCH_MAX = 64;

/* the query as the search reads it, or "" for no search */
export const searchTerm = (raw: string | null | undefined) =>
  (raw ?? "").trim().toLowerCase().slice(0, SEARCH_MAX);

/* a name cut round the first place the query falls in it: before, the match, after */
export function marked(text: string, q: string): [string, string, string] {
  const t = q.trim().toLowerCase();
  const i = t ? text.toLowerCase().indexOf(t) : -1;
  return i < 0
    ? [text, "", ""]
    : [text.slice(0, i), text.slice(i, i + t.length), text.slice(i + t.length)];
}

/* how many hits of one kind the answer carries; a chip shows them all */
export const PER_KIND = 10;
/* how many of each kind All shows */
export const ALL_PER_KIND = 3;

/* the kinds in the order they are listed when their best hits match as well */
const KINDS: ReadonlyArray<SearchKind> = [
  "people",
  "campaigns",
  "maps",
  "tracks",
  "dailies",
  "prefabs",
];
const HEADING: Record<SearchKind, string> = {
  people: "Players and makers",
  campaigns: "Campaigns",
  maps: "Maps",
  tracks: "Circuit",
  dailies: "Dailies",
  prefabs: "Prefabs",
};
const CHIP: Record<SearchKind, string> = { ...HEADING, people: "Players" };

export interface Chip {
  /* null for All */
  kind: SearchKind | null;
  label: string;
  /* how many it holds (Maps: every one that matched); none on All */
  count: number | null;
  on: boolean;
}
export interface Group {
  kind: SearchKind;
  /* over each kind under All; none under a chip, which names it */
  heading: string | null;
  hits: Array<Hit>;
  /* the link to All maps narrowed to the query, when more Maps matched than are shown */
  more: { total: number; href: string } | null;
}

/* what the dropdown shows of an answer with `only` (a chip) or All picked: the chips, All and
   one per kind found, the kind whose best hit matches best first; then each kind's hits */
export function resultsOf(
  a: SearchAnswer,
  only: SearchKind | null,
): { chips: Array<Chip>; groups: Array<Group> } {
  const best = (k: SearchKind) =>
    Math.max(...a.hits.filter((h) => h.kind === k).map((h) => Math.floor(h.score / 100)));
  const kinds = KINDS.filter((k) => a.hits.some((h) => h.kind === k)).sort(
    (x, y) => best(y) - best(x),
  );
  if (!kinds.length) return { chips: [], groups: [] };
  const shown = only && kinds.includes(only) ? only : null;
  const chips: Array<Chip> = [
    { kind: null, label: "All", count: null, on: shown === null },
    ...kinds.map((k) => ({
      kind: k,
      label: CHIP[k],
      count: k === "maps" ? a.mapTotal : a.hits.filter((h) => h.kind === k).length,
      on: shown === k,
    })),
  ];
  const groups = kinds
    .filter((k) => shown === null || shown === k)
    .map((k) => {
      const all = a.hits.filter((h) => h.kind === k);
      const hits = shown ? all : all.slice(0, ALL_PER_KIND);
      return {
        kind: k,
        heading: shown ? null : HEADING[k],
        hits,
        more:
          k === "maps" && a.mapTotal > hits.length
            ? { total: a.mapTotal, href: mapsSearchHref(a.q) }
            : null,
      };
    });
  return { chips, groups };
}

/* every hit of the query (trimmed, lowercased: searchTerm), best first within each kind */
export function searchAll(q: string, s: SearchSources): SearchAnswer {
  const found = searchMaps(s.cards, q);
  const hits = [
    people(q, s),
    campaigns(q, s.campaigns),
    maps(q, found),
    tracks(q, s.boards),
    dailies(q, s.dailies),
    prefabs(q, s.prefabs),
  ].flatMap((list) => list.sort((a, b) => b.score - a.score).slice(0, PER_KIND));
  return { q, hits, mapTotal: found.length };
}

/* how many Campaigns an empty field offers */
const JUMP_CAMPAIGNS = 2;

/* what an empty field offers to jump to: the newest Daily (today's while it is open), the
   newest Circuit season's Overall board, and the most played Campaigns */
export function jumpsOf(f: {
  /* oldest first */
  dailies: ReadonlyArray<Pick<DailyCell, "date" | "title" | "preview" | "final" | "entryCount">>;
  /* newest first */
  seasons: ReadonlyArray<{ group: string; overall: string; players: number }>;
  campaigns: ReadonlyArray<{
    slug: string;
    title: string;
    players: number;
    preview: string | null;
  }>;
}): Array<Hit> {
  const day = f.dailies.at(-1);
  const season = f.seasons.at(0);
  const jump = (h: Omit<Hit, "who" | "score">): Hit => ({ ...h, who: null, score: 0 });
  return [
    ...(day
      ? [
          jump({
            kind: "dailies",
            href: dailyHref(),
            title: day.title,
            meta:
              (day.final ? "Latest Daily · " : "Today's Daily · ") +
              plural(day.entryCount, "player", "players"),
            tag: "Daily",
            img: day.preview,
          }),
        ]
      : []),
    ...(season
      ? [
          jump({
            kind: "tracks",
            href: boardHref(season.overall),
            title: season.group,
            meta: "Circuit · " + plural(season.players, "player", "players"),
            tag: "Circuit",
            img: null,
          }),
        ]
      : []),
    ...[...f.campaigns]
      .sort((a, b) => b.players - a.players)
      .slice(0, JUMP_CAMPAIGNS)
      .map((c) =>
        jump({
          kind: "campaigns",
          href: campaignHref(c.slug),
          title: c.title,
          meta: "Campaign · " + plural(c.players, "player", "players"),
          tag: "Campaign",
          img: c.preview,
        }),
      ),
  ];
}
