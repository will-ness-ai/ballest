// The Weekly Cup's week (spec #353): its boundaries are US Central wall-clock times, so they hold
// across daylight saving. The week of Monday 26 October 2026 ends after the clocks go back on
// Sunday 1 November.
import { describe, expect, it } from "@effect/vitest";
import { weekAt } from "../src/weeklyCup/week.js";

const at = (iso: string) => Date.parse(iso);

describe("the Weekly Cup's week", () => {
  it("runs Monday 00:00 to Sunday 20:00 Central, across the November clock change", () => {
    const week = weekAt(at("2026-10-27T15:00:00Z"));
    expect(week).toEqual({
      week: "2026-10-26",
      // CDT, UTC-5
      opensAt: at("2026-10-26T05:00:00Z"),
      shortlistAt: at("2026-10-29T17:00:00Z"),
      voteClosesAt: at("2026-10-30T14:00:00Z"),
      // CST, UTC-6, after 02:00 on Sunday 1 November
      endsAt: at("2026-11-02T02:00:00Z"),
      nextOpensAt: at("2026-11-02T06:00:00Z"),
    });
  });

  it("starts at Monday 00:00 Central, not UTC", () => {
    // Sunday 23:30 Central is still the week before.
    expect(weekAt(at("2026-11-02T05:30:00Z")).week).toBe("2026-10-26");
    expect(weekAt(at("2026-11-02T06:00:00Z")).week).toBe("2026-11-02");
    expect(weekAt(at("2026-11-02T06:00:00Z")).shortlistAt).toBe(at("2026-11-05T18:00:00Z"));
  });

  it("holds the same local times across the March clock change", () => {
    // Daylight saving starts on Sunday 14 March 2027, before that week's Cup ends.
    const week = weekAt(at("2027-03-10T12:00:00Z"));
    expect(week.week).toBe("2027-03-08");
    expect(week.opensAt).toBe(at("2027-03-08T06:00:00Z"));
    expect(week.endsAt).toBe(at("2027-03-15T01:00:00Z"));
  });

  it("finds the week from any moment in it, its last hours included", () => {
    const monday = weekAt(at("2026-10-26T05:00:00Z"));
    const sundayNight = weekAt(at("2026-11-02T03:00:00Z"));
    expect(sundayNight).toEqual(monday);
  });
});
