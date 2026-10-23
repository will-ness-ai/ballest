// The site's navigation, from a path alone: the Section it is in (CONTEXT.md), that
// Section's sub-tabs with the lit one, what kind of page it is, and the breadcrumb trail
// above its title. The header (components/Shell.tsx) draws it.
import { eventOf } from "./campaigns";
import { circuitBoard } from "./circuit";
import {
  boardHref,
  campaignHref,
  campaignPath,
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
import { isPoints } from "./rules";

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

/* how many Campaigns the Campaigns Section's sub-tabs name after All Campaigns */
const NAV_CAMPAIGNS = 4;

/* the Campaigns the sub-tabs name: the most played, whether or not the list pins them;
   level ones keep the list's order */
export function navCampaigns(
  listed: ReadonlyArray<{ slug: string; title: string; players: number }>,
): NavFacts["campaigns"] {
  return [...listed]
    .sort((a, b) => b.players - a.players)
    .slice(0, NAV_CAMPAIGNS)
    .map(({ slug, title }) => ({ slug, title }));
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
  /* what kind of page it is, shown above its title; null off every Section */
  kind: string | null;
  /* the breadcrumbs above the page's title, top first; the page's own title is not one */
  trail: Array<Crumb>;
}
export interface Crumb {
  label: string;
  href: string;
}

/* the Sections in their order: the Workshop's Maps lead, as the homepage, and its Campaigns
   follow them; the Daily, a Map a day, comes next, then the Circuit on its newest season's
   Overall board, Players over every board, and the Prefabs for the level editor */
function sectionsOf(f: NavFacts): Array<Omit<SectionLink, "on"> & { shown: boolean }> {
  const newest = f.seasons.at(0);
  return [
    { key: "maps", label: "Maps", href: homeHref(), shown: f.workshop },
    { key: "campaigns", label: "Campaigns", href: campaignsHref(), shown: f.workshop },
    { key: "daily", label: "Daily", href: dailyHref(), shown: f.daily },
    {
      key: "circuit",
      label: "Circuit",
      href: newest ? boardHref(newest.overall) : homeHref(),
      shown: !!newest,
    },
    { key: "players", label: "Players", href: playersHref("all", "wr"), shown: true },
    { key: "prefabs", label: "Prefabs", href: prefabsHref(), shown: true },
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

/* what kind of page it is, the line above its title, in CONTEXT.md's words */
function kindOf(section: SectionKey | null, path: string): string | null {
  switch (section) {
    case "maps":
      return path.startsWith("/map/") ? "Workshop Map" : "Workshop";
    case "campaigns": {
      const at = campaignPath(path);
      if (!at) return "Campaigns";
      if (!at.map) return "Campaign";
      return eventOf(at.map) ? "Event board" : "Campaign Map";
    }
    case "daily":
      return path.startsWith(dailyStandingsHref()) ? "Daily standings" : "Daily";
    case "circuit":
      return isPoints(path.split("/")[2] ?? "") ? "Circuit standings" : "Circuit Track";
    case "players":
      if (path.startsWith("/player/")) return "Player";
      if (path.startsWith("/vs/")) return "Head to head";
      return /^\/you(\/|$)/.test(path) ? "Where you stand" : "Rankings";
    case "prefabs":
      if (path.startsWith("/prefab/")) return "Prefab";
      if (/^\/prefabs\/new(\/|$)/.test(path)) return "Upload";
      if (/^\/prefabs\/make\/./.test(path)) return "Generator";
      return /^\/prefabs\/make(\/|$)/.test(path) ? "Generators" : "Prefabs";
    default:
      return null;
  }
}

export function navOf(path: string, facts: NavFacts): Nav {
  const section = sectionOf(path);
  const all = sectionsOf(facts);
  const subs = subsOf(section, path, facts);
  const sub = subs.on >= 0 ? subs.list[subs.on] : undefined;
  /* the Section, its lit sub-tab, then the Campaign a page inside one belongs to when the
     sub-tabs don't name it; a crumb that is the page itself goes, as the page adds its own
     title */
  const home = all.find((s) => s.key === section && s.shown);
  const c = section === "campaigns" ? campaignPath(path)?.c : null;
  const here = path.replace(/(.)\/$/, "$1");
  const trail = [
    ...(home ? [{ label: home.label, href: home.href }] : []),
    ...(sub ? [sub] : []),
    ...(c && sub?.href !== campaignHref(c.slug)
      ? [{ label: c.title, href: campaignHref(c.slug) }]
      : []),
  ].filter((crumb) => crumb.href !== here);
  return {
    section,
    sections: all
      .filter((s) => s.shown)
      .map(({ key, label, href }) => ({ key, label, href, on: key === section })),
    subs: subs.list.map((s, i) => ({ ...s, on: i === subs.on })),
    kind: kindOf(section, path),
    trail,
  };
}
