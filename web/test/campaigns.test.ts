// The curated Campaigns (lib/campaigns.ts): the list itself must hold together, since a
// mistake in it would ship a broken page, and the lookups the site makes on it.
import { describe, expect, test } from "vitest";

import {
  CAMPAIGNS,
  campaignBoard,
  campaignOf,
  campaignOfBoard,
  campaignOfMap,
  campaignProblems,
  eventOf,
  mapLabel,
  mapName,
  mapNo,
  type Campaign,
} from "../lib/campaigns";

/* a Campaign the list holds, by its slug */
function curated(slug: string): Campaign {
  const c = campaignOf(slug);
  if (c === null) throw new Error(`no Campaign "${slug}"`);
  return c;
}

const make = (slug: string, maps: Array<string>): Campaign => ({
  slug,
  title: slug,
  creator: "Maker",
  creatorId: "76561199000000001",
  maps,
});

describe("the curated list", () => {
  test("holds together", () => {
    expect(campaignProblems(CAMPAIGNS)).toEqual([]);
  });

  test("starts with the five it launched with", () => {
    expect(CAMPAIGNS.slice(0, 5).map((c) => c.slug)).toEqual([
      "solar-trials",
      "velocity-trials",
      "tilted-campaign",
      "miniblack",
      "ajc",
    ]);
  });

  test("a collection that isn't a Workshop ID is a problem", () => {
    expect(campaignProblems([{ ...make("a", ["1"]), collection: "x12" }])).toEqual([
      '"a" names collection "x12", which is not a Workshop ID',
    ]);
    expect(campaignProblems([{ ...make("a", ["1"]), collection: "12" }])).toEqual([]);
  });

  test("a repeated slug is a problem", () => {
    expect(campaignProblems([make("a", ["1"]), make("a", ["2"])])).toEqual([
      'slug "a" is used twice',
    ]);
  });

  test("a Map in two Campaigns, or twice in one, is a problem", () => {
    expect(campaignProblems([make("a", ["1", "2"]), make("b", ["2"])])).toEqual([
      'Map 2 is in "a" and "b"',
    ]);
    expect(campaignProblems([make("a", ["1", "1"])])).toEqual(['Map 1 is in "a" and "a"']);
  });

  test("an empty Campaign is a problem", () => {
    expect(campaignProblems([make("a", [])])).toEqual(['"a" has no Maps']);
  });

  test("a Workshop ID that isn't one, or a slug that can't be a path, is a problem", () => {
    expect(campaignProblems([make("a", ["Workshop_1"])])).toEqual([
      '"a" lists "Workshop_1", which is not a Workshop ID or an Event',
    ]);
    expect(campaignProblems([make("Bad Slug", ["1"])])).toEqual([
      'slug "Bad Slug" is not lowercase words joined by -',
    ]);
  });
});

describe("Event boards in a Campaign", () => {
  test("an Event's id stands for it among a Campaign's Maps", () => {
    expect(campaignProblems([make("a", ["leth-trial-1"])])).toEqual([]);
    expect(campaignProblems([make("a", ["no-such-event"])])).toEqual([
      '"a" lists "no-such-event", which is not a Workshop ID or an Event',
    ]);
  });

  test("the Leth Trials holds Leth Trial #1, by Lethamyr, pinned", () => {
    const leth = curated("leth-trials");
    expect(leth).toMatchObject({
      title: "Leth Trials",
      creator: "Lethamyr",
      creatorId: "76561198184322235",
      maps: ["leth-trial-1"],
      pinned: true,
    });
    expect(eventOf("leth-trial-1")).toMatchObject({ board: "Map_LethTrial_01", viewer: "leth" });
    expect(mapLabel(leth, "leth-trial-1", "Leth Trial #1")).toBe("01 Leth Trial #1");
  });
});

describe("the lookups", () => {
  const solar = CAMPAIGNS[0];

  test("a Campaign's board is an Overall board named for its slug, and back", () => {
    expect(campaignBoard(solar)).toBe("OverallCampaign_solar-trials");
    for (const c of CAMPAIGNS) expect(campaignOfBoard(campaignBoard(c))).toBe(c);
    expect(campaignOfBoard("OverallCampaign_nope")).toBeNull();
    expect(campaignOfBoard("OverallLeaderboard")).toBeNull();
  });

  test("a Campaign by its slug", () => {
    expect(campaignOf("solar-trials")).toBe(solar);
    expect(campaignOf("nope")).toBeNull();
  });

  test("the Campaign a Map is in, and where", () => {
    expect(campaignOfMap("3805391903")).toEqual({ campaign: solar, index: 2 });
    expect(campaignOfMap("9000000001")).toBeNull();
  });

  test("a Map's number is its place in the Campaign, two digits as the rail shows it", () => {
    expect(mapNo(solar, "3805399883")).toBe("01");
    expect(mapNo(solar, "3805413302")).toBe("09");
    expect(mapNo(CAMPAIGNS[3], "3815119058")).toBe("10");
  });

  test("a Map's name in its Campaign drops the Campaign's name", () => {
    const name = (title: string) => mapName(solar, "3805399883", title);
    expect(name("Solar Trials Mercury")).toBe("Mercury");
    expect(name("solar trials  Finale The Sun")).toBe("Finale The Sun");
    /* a title that is only the name, or doesn't start with it, stays whole */
    expect(name("Solar Trials")).toBe("Solar Trials");
    expect(name("Mercury Solar Trials")).toBe("Mercury Solar Trials");
    expect(mapName(make("a.b", ["5"]), "5", "axb 2")).toBe("axb 2");
  });

  test("a Map's label is its number, then its title in the Campaign", () => {
    expect(mapLabel(solar, "3805399883", "Solar Trials Mercury")).toBe("01 Mercury");
    expect(mapLabel(solar, "3805413302", "Solar Trials Finale The Sun")).toBe("09 Finale The Sun");
    expect(mapLabel(solar, "3805394429", "Venus")).toBe("02 Venus");
  });

  test("a Map titled by its number alone is labelled with the number once", () => {
    const [, velocity, , miniblack, ajc] = CAMPAIGNS;
    // "Miniblack 01" would read "01 01", "AJC1" "01 1"
    expect(mapLabel(miniblack, "3811078255", "Miniblack 01")).toBe("01");
    expect(mapLabel(miniblack, "3815119058", "Miniblack 10")).toBe("10");
    expect(mapLabel(ajc, "3646349274", "AJC1")).toBe("01");
    expect(mapLabel(velocity, "3803937353", "Velocity Trials 5")).toBe("05");
    expect(mapName(ajc, "3788055152", "AJC5")).toBeNull();
    expect(mapName(solar, "3805399883", "Solar Trials Mercury")).toBe("Mercury");
    // a number that isn't the Map's place keeps the whole title, not "01 7"
    expect(mapLabel(velocity, "3803908791", "Velocity Trials 7")).toBe("01 Velocity Trials 7");
    const aj = curated("aj");
    const ninja = curated("ninja");
    expect(mapLabel(ninja, "3605138459", "Ninja0")).toBe("01 Ninja0");
    expect(mapLabel(aj, "3591825761", "AJ26")).toBe("03 AJ26");
    expect(mapLabel(aj, "3619755748", "AJ07 Redux")).toBe("01 AJ07 Redux");
    // titles that don't start with the Campaign's stay whole
    expect(mapLabel(curated("mind-trials"), "3821602774", "focus")).toBe("01 focus");
    // the maker's lowercase title and zero-padded number still read as the number alone
    const stoxy = curated("stoxys-mini-golf");
    expect(mapLabel(stoxy, "3821644937", "stoxy's mini golf 001")).toBe("01");
    expect(mapLabel(stoxy, "3821669040", "stoxy's mini golf 009")).toBe("09");
    // "1 of 8" counts the Maps, and the maker's last one reads "A08 of 8"
    const limbo = curated("limbo");
    expect(mapLabel(limbo, "3820698656", "Limbo campaign 1 of 8")).toBe("01");
    expect(mapLabel(limbo, "3821808619", "Limbo campaign A08 of 8")).toBe("08");
    // its place, then more of a name
    expect(mapName(make("a", ["5"]), "5", "a 1 Remix")).toBe("1 Remix");
  });
});
