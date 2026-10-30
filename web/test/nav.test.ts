// The navigation model (lib/nav.ts): from a path alone, the Section it is in, that Section's
// sub-tabs with the lit one, the kind of page, and the breadcrumb trail above its title.
import { describe, expect, test } from "vitest";

import { crumbsOf, navCampaigns, navOf, type NavFacts } from "../lib/nav";
import { legacyPath } from "../lib/routes";

const ID = "76561198259485267";
const RIVAL = "76561198078361919";

/* what the database tells the header: production's shape */
const FACTS: NavFacts = {
  workshop: true,
  daily: true,
  seasons: [
    { group: "Season 2", overall: "OverallLeaderboard_EASeason2" },
    { group: "Season 1", overall: "OverallLeaderboard_S1Current" },
    { group: "All Seasons", overall: "OverallLeaderboard_AllSeasons" },
  ],
  campaigns: [
    { slug: "leth-trials", title: "Leth Trials" },
    { slug: "solar-trials", title: "Solar Trials" },
    { slug: "velocity-trials", title: "Velocity Trials" },
  ],
};
const nav = (path: string) => navOf(path, FACTS);

describe("the Section a path is in", () => {
  test("every page in the qa catalogue", () => {
    const at: Record<string, string | null> = {
      "/": "maps",
      "/maps": "maps",
      "/maps/unbeaten": "maps",
      "/map/3800958793": "maps",
      [`/map/3800958793/${ID}`]: "maps",
      "/campaigns": "campaigns",
      "/campaign/solar-trials": "campaigns",
      "/campaign/solar-trials/podiums": "campaigns",
      "/campaign/solar-trials/3805413302": "campaigns",
      "/campaign/leth-trials/leth-trial-1": "campaigns",
      "/daily": "daily",
      "/daily/2026-09-05": "daily",
      "/daily/standings": "daily",
      "/board/Map_Track13": "circuit",
      [`/board/Map_Track13/${ID}`]: "circuit",
      "/board/OverallLeaderboard_S1Current": "circuit",
      "/board/OverallLeaderboard_AllSeasons": "circuit",
      "/board/OverallLeaderboard_EASeason2/podiums": "circuit",
      "/trials": "circuit",
      "/board/Map_TheTower": "circuit",
      [`/board/Map_TheTowerCP/${ID}`]: "circuit",
      [`/player/${ID}`]: "players",
      [`/player/${ID}/workshop`]: "players",
      [`/vs/${ID}/${RIVAL}`]: "players",
      "/players": "players",
      "/players/workshop/maps": "players",
      "/you": "players",
      "/prefabs": "prefabs",
      "/prefab/wrongwaysign": "prefabs",
      "/prefabs/new": "prefabs",
      "/prefabs/make": "prefabs",
      "/prefabs/make/sign": "prefabs",
      "/prefabs/guide": "prefabs",
      "/no-such-page": null,
    };
    for (const [path, section] of Object.entries(at)) expect(nav(path).section, path).toBe(section);
  });

  test("an old #/ link lands in its Section", () => {
    const at: Record<string, string> = {
      "#/workshop": "maps",
      "#/maps/unbeaten": "maps",
      "#/map/3623648768": "maps",
      "#/board/Map_Track13": "circuit",
      "#/board/OverallLeaderboard_EASeason2/podiums": "circuit",
      [`#/player/${ID}/workshop`]: "players",
      [`#/vs/${ID}/${RIVAL}`]: "players",
      "#/players/circuit/pod": "players",
    };
    for (const [hash, section] of Object.entries(at))
      expect(nav(legacyPath(hash) ?? "").section, hash).toBe(section);
  });

  test("a near miss is in none", () => {
    for (const path of ["/young", "/dailyish", "/prefabsy", "/campaignsy", "/board/Nope", "/mapsy"])
      expect(nav(path).section, path).toBeNull();
  });
});

describe("the Sections across the top", () => {
  test("Maps, Campaigns, Daily, Official, Players and Prefabs, the path's one lit", () => {
    expect(nav("/campaign/solar-trials").sections).toEqual([
      { key: "maps", label: "Maps", href: "/", on: false },
      { key: "campaigns", label: "Campaigns", href: "/campaigns", on: true },
      { key: "daily", label: "Daily", href: "/daily", on: false },
      /* Official opens on its newest season's Overall board, as the Circuit did */
      { key: "circuit", label: "Official", href: "/board/OverallLeaderboard_EASeason2", on: false },
      { key: "players", label: "Players", href: "/players", on: false },
      { key: "prefabs", label: "Prefabs", href: "/prefabs", on: false },
    ]);
    expect(nav("/no-such-page").sections.filter((s) => s.on)).toEqual([]);
  });

  test("a Section with nothing in it yet is left out", () => {
    const empty = navOf("/players", { workshop: false, daily: false, seasons: [], campaigns: [] });
    expect(empty.sections.map((s) => s.label)).toEqual(["Players", "Prefabs"]);
  });
});

describe("a Section's sub-tabs", () => {
  const subs = (path: string) => nav(path).subs.map((s) => [s.label, s.href]);
  const lit = (path: string) =>
    nav(path)
      .subs.filter((s) => s.on)
      .map((s) => s.label);

  test("each Section's own, in order", () => {
    expect(subs("/")).toEqual([
      ["Featured", "/"],
      ["All Maps", "/maps"],
    ]);
    /* All Campaigns, then the most-played ones by name */
    expect(subs("/campaigns")).toEqual([
      ["All Campaigns", "/campaigns"],
      ["Leth Trials", "/campaign/leth-trials"],
      ["Solar Trials", "/campaign/solar-trials"],
      ["Velocity Trials", "/campaign/velocity-trials"],
    ]);
    expect(subs("/daily")).toEqual([
      ["Today", "/daily"],
      ["Standings", "/daily/standings"],
    ]);
    /* each season, newest first, then the Trials */
    expect(subs("/board/Map_Track13")).toEqual([
      ["Season 2", "/board/OverallLeaderboard_EASeason2"],
      ["Season 1", "/board/OverallLeaderboard_S1Current"],
      ["All Seasons", "/board/OverallLeaderboard_AllSeasons"],
      ["Trials", "/trials"],
    ]);
    expect(subs("/players")).toEqual([
      ["Rankings", "/players"],
      ["Where you stand", "/you"],
    ]);
    expect(subs("/prefabs")).toEqual([
      ["Shared", "/prefabs"],
      ["Make your own", "/prefabs/make"],
      ["Upload", "/prefabs/new"],
      ["How to", "/prefabs/guide"],
    ]);
    expect(subs("/no-such-page")).toEqual([]);
  });

  test("the one lit for every page in the qa catalogue", () => {
    const at: Record<string, Array<string>> = {
      "/": ["Featured"],
      "/maps": ["All Maps"],
      "/maps/unbeaten": ["All Maps"],
      "/map/3800958793": ["All Maps"],
      [`/map/3800958793/${ID}`]: ["All Maps"],
      "/campaigns": ["All Campaigns"],
      "/campaign/solar-trials": ["Solar Trials"],
      "/campaign/solar-trials/podiums": ["Solar Trials"],
      /* a Campaign Map sits under its Campaign */
      "/campaign/solar-trials/3805413302": ["Solar Trials"],
      "/campaign/leth-trials/leth-trial-1": ["Leth Trials"],
      /* a Campaign the sub-tabs don't name is one of All Campaigns */
      "/campaign/miniblack": ["All Campaigns"],
      "/daily": ["Today"],
      "/daily/2026-09-05": ["Today"],
      "/daily/standings": ["Standings"],
      /* a board lights its own season */
      "/board/Map_Track13": ["Season 1"],
      [`/board/Map_Track13/${ID}`]: ["Season 1"],
      "/board/Map_Track_S2_Sampler": ["Season 2"],
      "/board/OverallLeaderboard_S1Current": ["Season 1"],
      "/board/OverallLeaderboard": ["Season 1"],
      "/board/OverallLeaderboard_AllSeasons": ["All Seasons"],
      "/board/OverallLeaderboard_EASeason2/podiums": ["Season 2"],
      /* a Trial's board lights the Trials */
      "/trials": ["Trials"],
      "/board/Map_TheTower": ["Trials"],
      [`/board/Map_TheTowerCP/${ID}`]: ["Trials"],
      /* a player's page and a head to head are the Rankings' */
      [`/player/${ID}`]: ["Rankings"],
      [`/player/${ID}/workshop`]: ["Rankings"],
      [`/vs/${ID}/${RIVAL}`]: ["Rankings"],
      "/players": ["Rankings"],
      "/players/workshop/maps": ["Rankings"],
      "/you": ["Where you stand"],
      "/prefabs": ["Shared"],
      "/prefab/wrongwaysign": ["Shared"],
      "/prefabs/new": ["Upload"],
      "/prefabs/make": ["Make your own"],
      "/prefabs/make/sign": ["Make your own"],
      "/prefabs/guide": ["How to"],
      "/no-such-page": [],
    };
    for (const [path, on] of Object.entries(at)) expect(lit(path), path).toEqual(on);
  });
});

describe("the Campaigns the sub-tabs name", () => {
  test("only the pinned ones, in the list's order", () => {
    const c = (slug: string, pinned = false) => ({ slug, title: slug.toUpperCase(), pinned });
    expect(navCampaigns([c("leth", true), c("b"), c("c"), c("other", true), c("d")])).toEqual([
      { slug: "leth", title: "LETH" },
      { slug: "other", title: "OTHER" },
    ]);
  });
});

describe("the kind of page", () => {
  test("every page in the qa catalogue", () => {
    const at: Record<string, string | null> = {
      "/": "Workshop",
      "/maps": "Workshop",
      "/map/3800958793": "Workshop Map",
      [`/map/3800958793/${ID}`]: "Workshop Map",
      "/campaigns": "Campaigns",
      "/campaign/solar-trials": "Campaign",
      "/campaign/solar-trials/podiums": "Campaign",
      [`/campaign/solar-trials/${ID}`]: "Campaign",
      "/campaign/solar-trials/3805413302": "Campaign Map",
      "/campaign/leth-trials/leth-trial-1": "Event board",
      "/daily": "Daily",
      "/daily/2026-09-05": "Daily",
      "/daily/standings": "Daily standings",
      "/board/Map_Track13": "Circuit Track",
      [`/board/Map_Track13/${ID}`]: "Circuit Track",
      "/board/OverallLeaderboard_S1Current": "Circuit standings",
      "/board/OverallLeaderboard_EASeason2/podiums": "Circuit standings",
      "/trials": "Trials",
      "/board/Map_TheTower": "Trial",
      [`/board/Map_TheTowerCP/${ID}`]: "Trial",
      [`/player/${ID}`]: "Player",
      [`/player/${ID}/circuit`]: "Player",
      [`/vs/${ID}/${RIVAL}`]: "Head to head",
      "/players": "Rankings",
      "/players/workshop/maps": "Rankings",
      "/you": "Where you stand",
      "/prefabs": "Prefabs",
      "/prefab/wrongwaysign": "Prefab",
      "/prefabs/new": "Upload",
      "/prefabs/make": "Generators",
      "/prefabs/make/sign": "Generator",
      "/prefabs/guide": "How to",
      "/no-such-page": null,
    };
    for (const [path, kind] of Object.entries(at)) expect(nav(path).kind, path).toBe(kind);
  });
});

describe("the breadcrumb trail", () => {
  /* the crumbs above the page's own title, which the page adds */
  const trail = (path: string) => nav(path).trail.map((c) => c.label);

  test("the Section, then the lit sub-tab, never the page itself", () => {
    expect(nav("/map/3800958793").trail).toEqual([
      { label: "Maps", href: "/" },
      { label: "All Maps", href: "/maps" },
    ]);
    const at: Record<string, Array<string>> = {
      "/": [],
      "/maps": ["Maps"],
      "/maps/unbeaten": ["Maps", "All Maps"],
      [`/map/3800958793/${ID}`]: ["Maps", "All Maps"],
      "/campaigns": [],
      "/campaign/solar-trials": ["Campaigns"],
      "/campaign/solar-trials/podiums": ["Campaigns", "Solar Trials"],
      "/daily": [],
      "/daily/2026-09-05": ["Daily", "Today"],
      "/daily/standings": ["Daily"],
      "/board/OverallLeaderboard_EASeason2": [],
      "/board/OverallLeaderboard_EASeason2/podiums": ["Official", "Season 2"],
      "/board/OverallLeaderboard_S1Current": ["Official"],
      "/board/Map_Track13": ["Official", "Season 1"],
      [`/board/Map_Track13/${ID}`]: ["Official", "Season 1"],
      "/board/OverallLeaderboard_AllSeasons": ["Official"],
      "/trials": ["Official"],
      "/board/Map_TheTower": ["Official", "Trials"],
      "/board/Map_TheTowerCP": ["Official", "Trials"],
      "/players": [],
      "/players/workshop/maps": ["Players", "Rankings"],
      "/you": ["Players"],
      "/prefabs": [],
      "/prefab/wrongwaysign": ["Prefabs", "Shared"],
      "/prefabs/new": ["Prefabs"],
      "/prefabs/make": ["Prefabs"],
      "/prefabs/make/sign": ["Prefabs", "Make your own"],
      "/no-such-page": [],
    };
    for (const [path, crumbs] of Object.entries(at)) expect(trail(path), path).toEqual(crumbs);
  });

  test("a Campaign Map sits under its Campaign", () => {
    expect(nav("/campaign/solar-trials/3805413302").trail).toEqual([
      { label: "Campaigns", href: "/campaigns" },
      { label: "Solar Trials", href: "/campaign/solar-trials" },
    ]);
    expect(trail("/campaign/leth-trials/leth-trial-1")).toEqual(["Campaigns", "Leth Trials"]);
    /* one the sub-tabs don't name sits under All Campaigns */
    expect(trail("/campaign/miniblack")).toEqual(["Campaigns", "All Campaigns"]);
    expect(nav("/campaign/miniblack/3811078255").trail.at(-1)).toEqual({
      label: "Miniblack",
      href: "/campaign/miniblack",
    });
  });

  test("a player's page and a head to head sit under Players", () => {
    for (const path of [`/player/${ID}`, `/player/${ID}/workshop`, `/vs/${ID}/${RIVAL}`])
      expect(trail(path), path).toEqual(["Players", "Rankings"]);
  });
});

describe("the breadcrumbs a page draws above its title", () => {
  const crumbs = (path: string, title: string, back: { label: string; href: string } | null) =>
    crumbsOf(path, FACTS, title, back).map((c) => c.label);

  test("with nothing remembered, the trail less any crumb that names the page's title", () => {
    expect(crumbsOf("/map/3800958793", FACTS, "Sway n So", null)).toEqual([
      { label: "Maps", href: "/" },
      { label: "All Maps", href: "/maps" },
    ]);
    expect(crumbs("/maps/unbeaten", "All maps", null)).toEqual(["Maps"]);
    expect(crumbs("/campaign/solar-trials/podiums", "Solar Trials", null)).toEqual(["Campaigns"]);
    expect(crumbs("/daily", "Sway n So", null)).toEqual([]);
  });

  test("coming to a Map from a player's page, the parent goes back there, under Players", () => {
    expect(
      crumbsOf("/map/3800958793", FACTS, "Sway n So", { label: "Will", href: `/player/${ID}` }),
    ).toEqual([
      { label: "Players", href: "/players" },
      { label: "Will", href: `/player/${ID}` },
    ]);
  });

  test("coming from a board, the parent is that board, under its Section", () => {
    expect(
      crumbs(`/player/${ID}`, "Will", { label: "Season 1 13", href: "/board/Map_Track13" }),
    ).toEqual(["Official", "Season 1 13"]);
    expect(
      crumbs(`/player/${ID}`, "Will", { label: "Sway n So", href: "/map/3800958793" }),
    ).toEqual(["Maps", "Sway n So"]);
    expect(
      crumbs("/map/3800958793", "Sway n So", {
        label: "Solar Trials 01 Ignition",
        href: "/campaign/solar-trials/3805413302",
      }),
    ).toEqual(["Campaigns", "Solar Trials 01 Ignition"]);
  });

  test("a remembered list a sub-tab names goes by the sub-tab's name", () => {
    expect(crumbs("/map/3800958793", "Sway n So", { label: "Workshop", href: "/" })).toEqual([
      "Maps",
      "Featured",
    ]);
    expect(crumbs(`/player/${ID}`, "Will", { label: "Players", href: "/players" })).toEqual([
      "Players",
      "Rankings",
    ]);
    expect(
      crumbs("/map/3800958793", "Sway n So", {
        label: "Solar Trials Overall",
        href: "/campaign/solar-trials",
      }),
    ).toEqual(["Campaigns", "Solar Trials"]);
    /* a view of All maps keeps the name it was remembered by */
    expect(
      crumbs("/map/3800958793", "Sway n So", { label: "All maps", href: "/maps/unbeaten" }),
    ).toEqual(["Maps", "All maps"]);
  });

  test("a remembered page that is this page, or in no Section, is passed over", () => {
    expect(
      crumbs("/map/3800958793", "Sway n So", { label: "Sway n So", href: "/map/3800958793" }),
    ).toEqual(["Maps", "All Maps"]);
    expect(crumbs("/map/3800958793", "Sway n So", { label: "Leth", href: "/leth/" })).toEqual([
      "Maps",
      "All Maps",
    ]);
  });
});
