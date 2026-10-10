// The page's invariants (lib/rules.ts), the URLs (lib/routes.ts) and the Circuit table
// (lib/circuit.ts), which has to agree with the collector's BOARDS.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { CIRCUIT, TRACKS } from "../lib/circuit";
import { calendarOf, dayLabel, isLive, timeLeft, todayOf } from "../lib/daily";
import {
  CREATOR_BEAT_MARGIN_TICKS,
  SCORE_TICKS_PER_SECOND,
  ageText,
  fmtSec,
  fmtTime,
  isPoints,
  isSteamId,
  mapPfidOf,
  ord,
  pctOf,
  personaOf,
  plural,
  relTime,
  shortGap,
  medalOf,
  timeMedal,
  trackPoints,
  value,
} from "../lib/rules";
import {
  boardHref,
  dailyHref,
  dailyStandingsHref,
  tabOfPath,
  isDailyDate,
  legacyPath,
  mapHref,
  playerHref,
  playersHref,
  signInHref,
  signOutHref,
  vsHref,
} from "../lib/routes";

const ID = "76561198259485267";

describe("a score's unit", () => {
  test("a run time is hundred-thousandths of a second, not milliseconds", () => {
    expect(SCORE_TICKS_PER_SECOND).toBe(100000);
    expect(fmtTime(1026700)).toBe("0:10.267");
    expect(fmtTime(10626700)).toBe("1:46.267");
    expect(fmtTime(360000000)).toBe("1:00:00.000");
  });

  test("an Overall board is points, read from the name alone", () => {
    expect(isPoints("OverallLeaderboard_EASeason2")).toBe(true);
    expect(isPoints("OverallLeaderboard_AllSeasons")).toBe(true);
    expect(isPoints("Map_Track13")).toBe(false);
    expect(isPoints("Workshop_123")).toBe(false);
    expect(value("OverallLeaderboard", 1234567)).toBe("1,234,567");
    expect(value("Map_Track13", 1234567)).toBe("0:12.345");
  });

  test("Medal times are seconds, gaps drop the minutes under a minute", () => {
    expect(fmtSec(12.792)).toBe("0:12.792");
    expect(shortGap(123400)).toBe("+1.234");
    expect(shortGap(6543210)).toBe("+1:05.432");
  });
});

describe("words and numbers", () => {
  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ord)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
  });

  test("plurals and personas", () => {
    expect(plural(1, "run", "runs")).toBe("1 run");
    expect(plural(1200, "run", "runs")).toBe("1,200 runs");
    expect(personaOf({ steamId: ID, persona: "" })).toBe("Player 485267");
    expect(personaOf({ steamId: ID, persona: "Hky." })).toBe("Hky.");
  });

  test("relative times", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const ago = (s: number) => relTime(new Date(now - s * 1000), now);
    expect([ago(30), ago(60), ago(3600 * 5), ago(86400 * 3)]).toEqual([
      "just now",
      "1 minute ago",
      "5 hours ago",
      "3 days ago",
    ]);
    const created = now / 1000 - 86400 * 90;
    expect(ageText(created, now)).toBe("3 months ago");
    expect(ageText(now / 1000 - 3600, now)).toBe("today");
  });

  test("a field position never claims top 0.0%", () => {
    expect(pctOf(1, 10000)).toBe("top 0.1%");
    expect(pctOf(50, 1000)).toBe("top 5%");
  });
});

describe("the game's rules", () => {
  test("a Track's points for a place (track_points in campaign_common.py)", () => {
    expect([1, 2, 3, 10, 11, 100, 101, 1000, 10000].map(trackPoints)).toEqual([
      40000, 20000, 13333, 4000, 3618, 2000, 1890, 1000, 500,
    ]);
  });

  test("a Medal is the best target the time meets; rank 1 is a world record instead", () => {
    const medals = [30, 20, 15, 12];
    expect(medalOf(medals, 1, 2000000)).toBe("wr");
    expect(medalOf(medals, 2, 1200000)).toBe("author");
    expect(medalOf(medals, 2, 1500000)).toBe("gold");
    expect(medalOf(medals, 2, 2500000)).toBe("bronze");
    expect(medalOf(medals, 2, 3000001)).toBe("none");
  });

  test("a time's own Medal, as a Daily shows it, has no world record", () => {
    const medals = [30, 20, 15, 12];
    expect(timeMedal(medals, 1200000)).toBe("author");
    expect(timeMedal(medals, 2000000)).toBe("silver");
    expect(timeMedal(medals, 3000001)).toBe("none");
    // a Map no catalogue has listed has no Medals to meet
    expect(timeMedal([], 1)).toBe("none");
  });

  test("a creator's own margin applies to authorBeaten alone, as the collector's does", () => {
    // the collector's author_beaten and workshopMaps' SQL share the margin
    const py = readFileSync(new URL("../../tools/campaign_common.py", import.meta.url), "utf8");
    expect(Number(/^CREATOR_BEAT_MARGIN_TICKS = (\d+)/m.exec(py)?.[1])).toBe(
      CREATOR_BEAT_MARGIN_TICKS,
    );
    // a Medal does not: a run at the author time is an author Medal, whoever set it,
    // as on the old page
    expect(medalOf([30, 20, 15, 12], 2, 12 * SCORE_TICKS_PER_SECOND)).toBe("author");
  });
});

describe("a Daily", () => {
  const d = { endsAt: "2026-10-08T01:00:00.000Z", final: false };
  const at = (s: string) => Date.parse(s);

  test("is live until its close by the reader's clock, or until a read after it made it final", () => {
    expect(isLive(d, at("2026-10-08T00:59:00Z"))).toBe(true);
    expect(isLive(d, at("2026-10-08T01:00:00Z"))).toBe(false);
    // a reader's clock running slow never reopens a final Daily
    expect(isLive({ ...d, final: true }, at("2026-10-08T00:59:00Z"))).toBe(false);
    // before the page runs there is no reader's clock: the database alone decides
    expect(isLive(d, null)).toBe(true);
    expect(isLive({ ...d, final: true }, null)).toBe(false);
  });

  test("counts down in hours and minutes", () => {
    expect(timeLeft(5 * 3600_000 + 3 * 60_000)).toBe("5h 03m");
    expect(timeLeft(59_000)).toBe("0h 01m");
    expect(timeLeft(-5)).toBe("0h 00m");
  });

  test("the calendar: every month with a Daily, newest first, each laid out from Sunday", () => {
    const days = [{ date: "2026-08-30" }, { date: "2026-08-31" }, { date: "2026-09-02" }];
    const months = calendarOf(days);
    expect(months.map((m) => [m.month, m.name, m.lead, m.days.length])).toEqual([
      // Sep 1 2026 is a Tuesday, Aug 1 a Saturday
      ["2026-09", "September 2026", 2, 30],
      ["2026-08", "August 2026", 6, 31],
    ]);
    expect(months[0].days.slice(0, 3)).toEqual([
      { n: 1, date: "2026-09-01", daily: null },
      { n: 2, date: "2026-09-02", daily: days[2] },
      { n: 3, date: "2026-09-03", daily: null },
    ]);
    expect(months[1].days.at(-1)).toEqual({ n: 31, date: "2026-08-31", daily: days[1] });
    expect(calendarOf([])).toEqual([]);
  });

  test("today is the newest Daily, while it is live", () => {
    const old = { date: "2026-10-06", endsAt: "2026-10-07T01:00:00.000Z", final: true };
    const newest = { ...old, date: "2026-10-07", endsAt: "2026-10-08T01:00:00.000Z", final: false };
    expect(todayOf([old, newest], at("2026-10-08T00:00:00Z"))).toBe("2026-10-07");
    expect(todayOf([old, newest], at("2026-10-08T01:00:00Z"))).toBeNull();
    expect(todayOf([old], null)).toBeNull();
    expect(todayOf([], null)).toBeNull();
  });

  test("is named by its own date, in no time zone", () => {
    expect(dayLabel("2026-09-05")).toBe("Sat, Sep 5");
    expect(dayLabel("2026-09-05", true)).toBe("Sat, Sep 5, 2026");
  });
});

describe("Steam IDs and URLs", () => {
  test("only a plain Steam64 is an ID", () => {
    expect(isSteamId(ID)).toBe(true);
    expect(isSteamId("123")).toBe(false);
    expect(isSteamId(ID + "x")).toBe(false);
    expect(isSteamId(null)).toBe(false);
  });

  test("links", () => {
    expect(playerHref(ID)).toBe(`/player/${ID}`);
    expect(playerHref(ID, "made")).toBe(`/player/${ID}/made`);
    expect(playerHref("<script>")).toBe("/");
    expect(boardHref("Map_Track13")).toBe("/board/Map_Track13");
    expect(boardHref("Map_Track13", ID)).toBe(`/board/Map_Track13/${ID}`);
    expect(boardHref("OverallLeaderboard", "podiums")).toBe("/board/OverallLeaderboard/podiums");
    expect(boardHref("Workshop_3623648768", ID)).toBe(`/map/3623648768/${ID}`);
    expect(mapPfidOf("Workshop_42")).toBe("42");
    expect(mapPfidOf("Map_Track13")).toBeNull();
    expect(mapHref("42")).toBe("/map/42");
    expect(vsHref(ID, "76561198000000001")).toBe(`/vs/${ID}/76561198000000001`);
    expect(playersHref("all", "wr")).toBe("/players");
    expect(playersHref("workshop", "maps")).toBe("/players/workshop/maps");
    expect(dailyHref()).toBe("/daily");
    expect(dailyHref("2026-09-05")).toBe("/daily/2026-09-05");
    expect(dailyHref("../x")).toBe("/daily");
    expect(dailyStandingsHref()).toBe("/daily/standings");
  });

  test("a Daily's date is a real day, written YYYY-MM-DD", () => {
    expect(isDailyDate("2026-09-05")).toBe(true);
    expect(isDailyDate("2026-02-30")).toBe(false);
    expect(isDailyDate("2026-9-5")).toBe(false);
    expect(isDailyDate("standings")).toBe(false);
    expect(isDailyDate(undefined)).toBe(false);
  });

  test("which tab a path lights", () => {
    expect(tabOfPath("/")).toBe("Workshop");
    expect(tabOfPath("/map/42")).toBe("Workshop");
    expect(tabOfPath("/players/circuit/pod")).toBe("Players");
    expect(tabOfPath("/daily")).toBe("Daily");
    expect(tabOfPath("/daily/2026-09-05")).toBe("Daily");
    expect(tabOfPath("/daily/standings")).toBe("Daily");
    expect(tabOfPath("/dailyish")).toBeNull();
    /* every Circuit board, whatever its season, lights the one Circuit tab */
    expect(tabOfPath("/board/OverallLeaderboard_EASeason2")).toBe("Circuit");
    expect(tabOfPath("/board/OverallLeaderboard")).toBe("Circuit");
    expect(tabOfPath("/board/OverallLeaderboard_AllSeasons/podiums")).toBe("Circuit");
    expect(tabOfPath("/board/Map_Track13")).toBe("Circuit");
    expect(tabOfPath("/board/Nope")).toBeNull();
    expect(tabOfPath(`/player/${ID}`)).toBeNull();
  });

  test("every old #/ link lands on its path", () => {
    expect(legacyPath(`#/player/${ID}/workshop`)).toBe(`/player/${ID}/workshop`);
    expect(legacyPath(`#/board/Map_Track13/${ID}`)).toBe(`/board/Map_Track13/${ID}`);
    expect(legacyPath("#/board/OverallLeaderboard_EASeason2/podiums")).toBe(
      "/board/OverallLeaderboard_EASeason2/podiums",
    );
    expect(legacyPath(`#/vs/${ID}/76561198000000001`)).toBe(`/vs/${ID}/76561198000000001`);
    expect(legacyPath("#/players/circuit/pod")).toBe("/players/circuit/pod");
    expect(legacyPath("#/players")).toBe("/players");
    expect(legacyPath("#/map/3623648768")).toBe("/map/3623648768");
    expect(legacyPath("#/maps/unbeaten")).toBe("/maps/unbeaten");
    expect(legacyPath("#/workshop")).toBe("/");
    expect(legacyPath("#section")).toBeNull();
  });
});

describe("the Circuit table", () => {
  // BOARDS in the collector is the site's order and the in-game numbering
  const py = readFileSync(new URL("../../tools/campaign_common.py", import.meta.url), "utf8");
  const list = (name: string) =>
    [
      ...(new RegExp(`^${name} = \\[([^\\]]*)\\]`, "m").exec(py)?.[1] ?? "").matchAll(/"(\w+)"/g),
    ].map((m) => m[1]);

  test("lists the collector's Tracks in its order", () => {
    const tracks = CIRCUIT.filter((b) => b.name.startsWith("Map_"));
    expect(tracks.filter((b) => b.group === "Season 1").map((b) => b.name)).toEqual(
      list("S1_TRACKS"),
    );
    expect(tracks.filter((b) => b.group === "Season 2").map((b) => b.name)).toEqual(
      list("S2_TRACKS"),
    );
    expect(Object.keys(TRACKS).sort()).toEqual(tracks.map((b) => b.name).sort());
  });

  test("names them as the collector does (display_name, track_tier)", () => {
    const by = Object.fromEntries(CIRCUIT.map((b) => [b.name, b]));
    expect(by.Map_Track13).toMatchObject({ display: "01", tier: null });
    expect(by.Map_Track_S2_NightCondo).toMatchObject({
      display: "09 Night Condo",
      tier: "Advanced",
    });
    expect(by.Map_Track_S2_BigStairs.tier).toBe("Beginner");
    expect(by.Map_Track_S2_Checkerboard.tier).toBe("Intermediate");
    expect(by.OverallLeaderboard_S1Current.display).toBe("Current");
  });
});

test("signing in and out come back to the page they were asked from", () => {
  expect(signInHref("/board/Map_Track13")).toBe("/api/auth/steam?next=%2Fboard%2FMap_Track13");
  expect(signOutHref("/player/" + ID)).toBe("/api/auth/signout?next=%2Fplayer%2F" + ID);
});
