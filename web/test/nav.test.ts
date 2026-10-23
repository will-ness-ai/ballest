// The navigation model (lib/nav.ts): from a path alone, the Section it is in, that Section's
// sub-tabs with the lit one, the kind of page, and the breadcrumb trail above its title.
import { describe, expect, test } from "vitest";

import { navOf, type NavFacts } from "../lib/nav";

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
      "/prefabs/make/qr": "prefabs",
      "/no-such-page": null,
    };
    for (const [path, section] of Object.entries(at))
      expect(nav(path).section, path).toBe(section);
  });

  test("a near miss is in none", () => {
    for (const path of ["/young", "/dailyish", "/prefabsy", "/campaignsy", "/board/Nope", "/mapsy"])
      expect(nav(path).section, path).toBeNull();
  });
});

describe("the Sections across the top", () => {
  test("Maps, Campaigns, Daily, Circuit, Players and Prefabs, the path's one lit", () => {
    expect(nav("/campaign/solar-trials").sections).toEqual([
      { key: "maps", label: "Maps", href: "/", on: false },
      { key: "campaigns", label: "Campaigns", href: "/campaigns", on: true },
      { key: "daily", label: "Daily", href: "/daily", on: false },
      /* the Circuit opens on its newest season's Overall board */
      { key: "circuit", label: "Circuit", href: "/board/OverallLeaderboard_EASeason2", on: false },
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
  const lit = (path: string) => nav(path).subs.filter((s) => s.on).map((s) => s.label);

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
    /* each season, newest first */
    expect(subs("/board/Map_Track13")).toEqual([
      ["Season 2", "/board/OverallLeaderboard_EASeason2"],
      ["Season 1", "/board/OverallLeaderboard_S1Current"],
      ["All Seasons", "/board/OverallLeaderboard_AllSeasons"],
    ]);
    expect(subs("/players")).toEqual([
      ["Rankings", "/players"],
      ["Where you stand", "/you"],
    ]);
    expect(subs("/prefabs")).toEqual([
      ["Shared", "/prefabs"],
      ["Make your own", "/prefabs/make"],
      ["Upload", "/prefabs/new"],
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
      "/prefabs/make/qr": ["Make your own"],
      "/no-such-page": [],
    };
    for (const [path, on] of Object.entries(at)) expect(lit(path), path).toEqual(on);
  });
});
