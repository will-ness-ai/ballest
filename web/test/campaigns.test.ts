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
  mapNo,
  shortTitle,
  type Campaign,
} from "../lib/campaigns";

const make = (slug: string, maps: Array<string>): Campaign => ({
  slug,
  title: slug,
  creator: "Maker",
  cid: "76561199000000001",
  maps,
});

describe("the curated list", () => {
  test("holds together", () => {
    expect(campaignProblems(CAMPAIGNS)).toEqual([]);
  });

  test("launches with the five Campaigns", () => {
    expect(CAMPAIGNS.map((c) => c.slug)).toEqual([
      "solar-trials",
      "velocity-trials",
      "tilted-campaign",
      "miniblack",
      "ajc",
    ]);
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
      '"a" lists "Workshop_1", which is not a Workshop ID',
    ]);
    expect(campaignProblems([make("Bad Slug", ["1"])])).toEqual([
      'slug "Bad Slug" is not lowercase words joined by -',
    ]);
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

  test("a Map's title in its Campaign drops the Campaign's name", () => {
    expect(shortTitle(solar, "Solar Trials Mercury")).toBe("Mercury");
    expect(shortTitle(solar, "solar trials  Finale The Sun")).toBe("Finale The Sun");
    expect(shortTitle(make("ajc", []), "AJC1")).toBe("1");
    /* a title that is only the name, or doesn't start with it, stays whole */
    expect(shortTitle(solar, "Solar Trials")).toBe("Solar Trials");
    expect(shortTitle(solar, "Mercury Solar Trials")).toBe("Mercury Solar Trials");
    expect(shortTitle(make("a.b", []), "axb 2")).toBe("axb 2");
  });
});
