// The site's navigation, from a path alone: the Section it is in (CONTEXT.md), that
// Section's sub-tabs with the lit one, what kind of page it is, and the breadcrumb trail
// above its title. The header (components/Shell.tsx) draws it.
import { circuitBoard } from "./circuit";
import {
  boardHref,
  campaignHref,
  campaignsHref,
  dailyHref,
  dailyStandingsHref,
  homeHref,
  makePrefabHref,
  mapsHref,
  newPrefabHref,
  playersHref,
  prefabsHref,
  youHref,
} from "./routes";

export type SectionKey = "maps" | "campaigns" | "daily" | "circuit" | "players" | "prefabs";

/* what only the database knows: whether the Workshop and the Daily have anything yet, the
   Circuit's seasons newest first, and the Campaigns the Campaigns Section names, most played
   first */
export interface NavFacts {
  workshop: boolean;
  daily: boolean;
  seasons: ReadonlyArray<{ group: string; overall: string }>;
  campaigns: ReadonlyArray<{ slug: string; title: string }>;
}

/* a link in the header; `on` is the one the page is at or under */
export interface NavLink {
  label: string;
  href: string;
  on: boolean;
}
export interface SectionLink extends NavLink {
  key: SectionKey;
}

export interface Nav {
  section: SectionKey | null;
  /* the Sections across the top; one with nothing in it yet is left out */
  sections: Array<SectionLink>;
  /* the Section's own sub-tabs, the one the page is at or under lit */
  subs: Array<NavLink>;
}

/* the Sections in their order: the Workshop's Maps lead, as the homepage, and its Campaigns
   follow them; the Daily, a Map a day, comes next, then the Circuit on its newest season's
   Overall board, Players over every board, and the Prefabs for the level editor */
function sectionsOf(f: NavFacts): Array<Omit<SectionLink, "on">> {
  const newest = f.seasons.at(0);
  return [
    ...(f.workshop
      ? [
          { key: "maps" as const, label: "Maps", href: homeHref() },
          { key: "campaigns" as const, label: "Campaigns", href: campaignsHref() },
        ]
      : []),
    ...(f.daily ? [{ key: "daily" as const, label: "Daily", href: dailyHref() }] : []),
    ...(newest
      ? [{ key: "circuit" as const, label: "Circuit", href: boardHref(newest.overall) }]
      : []),
    { key: "players", label: "Players", href: playersHref("all", "wr") },
    { key: "prefabs", label: "Prefabs", href: prefabsHref() },
  ];
}

function sectionOf(path: string): SectionKey | null {
  if (path === "/" || /^\/maps?(\/|$)/.test(path)) return "maps";
  if (/^\/campaigns?(\/|$)/.test(path)) return "campaigns";
  if (/^\/daily(\/|$)/.test(path)) return "daily";
  if (/^\/(players?|you|vs)(\/|$)/.test(path)) return "players";
  if (/^\/prefabs?(\/|$)/.test(path)) return "prefabs";
  const board = /^\/board\/([^/]+)/.exec(path);
  return board && circuitBoard(decodeURIComponent(board[1])) ? "circuit" : null;
}

/* a Section's sub-tabs, and which one the path is at or under: every page of a Section
   lights one, so a page that is none of them lights the list it is reached from (a Map
   All Maps, a player's page the Rankings) */
function subsOf(
  section: SectionKey | null,
  path: string,
  f: NavFacts,
): { list: Array<Omit<NavLink, "on">>; on: number } {
  switch (section) {
    case "maps":
      return {
        list: [
          { label: "Featured", href: homeHref() },
          { label: "All Maps", href: mapsHref() },
        ],
        on: path === "/" ? 0 : 1,
      };
    case "campaigns": {
      const slug = /^\/campaign\/([^/]+)/.exec(path)?.[1];
      return {
        list: [
          { label: "All Campaigns", href: campaignsHref() },
          ...f.campaigns.map((c) => ({ label: c.title, href: campaignHref(c.slug) })),
        ],
        on: f.campaigns.findIndex((c) => c.slug === slug) + 1,
      };
    }
    case "daily":
      return {
        list: [
          { label: "Today", href: dailyHref() },
          { label: "Standings", href: dailyStandingsHref() },
        ],
        on: path.startsWith(dailyStandingsHref()) ? 1 : 0,
      };
    case "circuit": {
      const board = circuitBoard(decodeURIComponent(path.split("/")[2] ?? ""));
      return {
        list: f.seasons.map((s) => ({ label: s.group, href: boardHref(s.overall) })),
        on: f.seasons.findIndex((s) => s.group === board?.group),
      };
    }
    case "players":
      return {
        list: [
          { label: "Rankings", href: playersHref("all", "wr") },
          { label: "Where you stand", href: youHref() },
        ],
        on: /^\/you(\/|$)/.test(path) ? 1 : 0,
      };
    case "prefabs":
      return {
        list: [
          { label: "Shared", href: prefabsHref() },
          { label: "Make your own", href: makePrefabHref() },
          { label: "Upload", href: newPrefabHref() },
        ],
        on: /^\/prefabs\/make(\/|$)/.test(path) ? 1 : /^\/prefabs\/new(\/|$)/.test(path) ? 2 : 0,
      };
    default:
      return { list: [], on: -1 };
  }
}

export function navOf(path: string, facts: NavFacts): Nav {
  const section = sectionOf(path);
  const subs = subsOf(section, path, facts);
  return {
    section,
    sections: sectionsOf(facts).map((s) => ({ ...s, on: s.key === section })),
    subs: subs.list.map((s, i) => ({ ...s, on: i === subs.on })),
  };
}
