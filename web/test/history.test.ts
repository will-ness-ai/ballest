// A board's record history (lib/history.ts): Reigns, Climbers and the day list, from Entries
// written out here by hand. Refresh k starts at hour 3k on 1 Sep (UTC), so r(8) is 2 Sep.
import { describe, expect, test } from "vitest";

import {
  boardHistory,
  changesText,
  cutText,
  dayText,
  gapText,
  heldText,
  longDayText,
  setText,
  type HistoryEntry,
} from "../lib/history";

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const r = (k: number) => new Date(Date.UTC(2026, 8, 1, 3 * k)).toISOString();
const NOW = 12;

/* player n's time `score`, first seen in Refresh f, last seen in l, closed in c */
const e = (
  n: number,
  score: number,
  f: number,
  l = NOW,
  c: number | null = null,
): HistoryEntry => ({
  steamId: p(n),
  persona: "P" + String(n),
  score,
  firstSeenAt: r(f),
  lastSeenAt: r(l),
  closedAt: c === null ? null : r(c),
});
const history = (entries: Array<HistoryEntry>, now = NOW) => boardHistory({ now: r(now), entries });

describe("Reigns", () => {
  test("the record changes hands on each faster time, with its cut and when it stood", () => {
    const h = history([
      e(1, 1_000_000, 0, 1, 2), // P1 holds it from before history, improves at r2
      e(2, 1_100_000, 0),
      e(1, 990_000, 2, 4, 5),
      e(2, 980_000, 5), // P2 takes it at r5
      e(1, 970_000, 5), // ...and P1 beats that in the same Refresh
    ]);
    expect(
      h?.reigns.map((x) => [x.persona, x.score, x.from, x.to, x.cut, x.beforeHistory]),
    ).toEqual([
      ["P1", 1_000_000, r(0), r(2), null, true],
      ["P1", 990_000, r(2), r(5), 10_000, false],
      ["P1", 970_000, r(5), null, 20_000, false],
    ]);
    expect(h?.since).toBe(r(0));
  });

  test("an equal time is not a new record", () => {
    const h = history([e(2, 1_000_000, 0), e(1, 1_000_000, 3)]);
    expect(h?.reigns.map((x) => x.persona)).toEqual(["P2"]);
  });

  test("a run seen once and then removed never holds the record", () => {
    const h = history([e(1, 1_000_000, 0), e(2, 500_000, 3, 3, 4)]);
    expect(h?.reigns.map((x) => [x.persona, x.to])).toEqual([["P1", null]]);
    expect(h?.days).toEqual([]);
  });

  test("a time its player beat by the next Refresh still counts", () => {
    const h = history([e(1, 1_000_000, 0), e(2, 990_000, 3, 3, 4), e(2, 980_000, 4)]);
    expect(h?.reigns.map((x) => [x.persona, x.score])).toEqual([
      ["P1", 1_000_000],
      ["P2", 990_000],
      ["P2", 980_000],
    ]);
  });

  test("a record holder who leaves the board hands it back, with no cut", () => {
    const h = history([e(1, 1_000_000, 0), e(2, 900_000, 2, 6, 7)]);
    expect(h?.reigns.map((x) => [x.persona, x.from, x.to, x.cut])).toEqual([
      ["P1", r(0), r(2), null],
      ["P2", r(2), r(7), 100_000],
      ["P1", r(7), null, null],
    ]);
  });

  test("a record handed back is counted on the day it was set, not again", () => {
    const h = history([e(1, 1_000_000, 0), e(3, 950_000, 2, 30, 31), e(2, 900_000, 10, 20, 21)]);
    // P3 set it on day 1, P2 took it on day 2 and left on day 3, handing it back to P3
    expect(h?.days.map((d) => [d.day, d.records.map((x) => [x.persona, x.beat])])).toEqual([
      ["2026-09-02", [["P2", { persona: "P3", cut: 50_000 }]]],
      ["2026-09-01", [["P3", { persona: "P1", cut: 50_000 }]]],
    ]);
  });

  test("a board that never changed has one Reign, still standing", () => {
    const h = history([e(1, 1_000_000, 0), e(2, 1_100_000, 0)]);
    expect(h?.reigns).toHaveLength(1);
    expect(h?.reigns[0].to).toBeNull();
    expect(h?.days).toEqual([]);
  });

  test("a board first read after history began dates its first record then or earlier", () => {
    const h = history([e(1, 1_000_000, 6), e(2, 1_100_000, 6), e(3, 1_050_000, 9)]);
    expect(h?.since).toBe(r(6));
    expect(h?.reigns[0].beforeHistory).toBe(true);
    // what was there at the first read is not news; P3's time three Refreshes later is
    expect(h?.days.map((d) => [d.day, d.firstTimes])).toEqual([["2026-09-02", 1]]);
  });

  test("a board with no Entries has no history", () => {
    expect(history([])).toBeNull();
  });
});

describe("Climbers", () => {
  // the week runs from day 1 to day 8: Refresh 64 is 9 Sep, 7 days after Refresh 8
  const later = 64;
  test("places gained over the week, among the top 100 now, most first", () => {
    const h = history(
      [
        e(1, 1_000_000, 0, later),
        e(2, 1_100_000, 0, later),
        e(3, 1_200_000, 0, later),
        e(4, 1_300_000, 0, 20, 21),
        e(4, 1_050_000, 21, later), // 4th to 2nd
        e(5, 1_400_000, 0, 30, 31),
        e(5, 900_000, 31, later), // 5th to 1st
        e(6, 1_150_000, 40, later), // new this week
      ],
      later,
    );
    expect(h?.weekFrom).toBe(r(later - 56));
    expect(h?.climbers.map((c) => [c.persona, c.was, c.rank, c.cut])).toEqual([
      ["P5", 5, 1, 500_000],
      ["P4", 4, 3, 250_000],
    ]);
    expect(h?.arrivals.map((a) => [a.persona, a.rank])).toEqual([["P6", 5]]);
  });

  test("a board younger than a week counts from its first Refresh", () => {
    const h = history([e(1, 1_000_000, 4), e(2, 900_000, 6)]);
    expect(h?.weekFrom).toBe(r(4));
    expect(h?.arrivals.map((a) => a.persona)).toEqual(["P2"]);
  });
});

describe("the day list", () => {
  test("each day's records, new top 10 times and counts, newest day first", () => {
    const base = Array.from({ length: 12 }, (_, i) => e(i + 1, 2_000_000 + i * 10_000, 0));
    const h = history([
      ...base.map((x, i) =>
        i === 2
          ? { ...x, lastSeenAt: r(9), closedAt: r(10) }
          : i === 11
            ? { ...x, lastSeenAt: r(2), closedAt: r(3) }
            : x,
      ),
      e(3, 1_900_000, 10), // day 2: P3 takes the record from P1
      e(13, 2_015_000, 10), // day 2: a first time that goes 3rd: a top 10 time
      e(14, 9_000_000, 10), // day 2: a first time far down
      e(12, 2_100_000, 3), // day 1: P12 improves, but stays 12th
    ]);
    expect(h?.days.map((d) => d.day)).toEqual(["2026-09-02", "2026-09-01"]);
    const [d2, d1] = h?.days ?? [];
    expect(d2.records).toEqual([
      { steamId: p(3), persona: "P3", score: 1_900_000, beat: { persona: "P1", cut: 100_000 } },
    ]);
    expect(d2.topTen.map((t) => [t.persona, t.cut])).toEqual([["P13", null]]);
    expect([d2.improved, d2.firstTimes]).toEqual([1, 2]);
    expect([d1.records, d1.topTen, d1.improved, d1.firstTimes]).toEqual([[], [], 1, 0]);
  });
});

describe("the card's words", () => {
  const h = history([e(1, 1_000_000, 0, 1, 2), e(1, 999_979, 2, 9, 10), e(2, 900_000, 10)]);

  test("dates are UTC days, and a record from the first Refresh was set then or earlier", () => {
    expect(dayText("2026-09-06T23:59:00Z")).toBe("6 Sep");
    expect(longDayText("2026-10-03")).toBe("Saturday 3 Oct");
    expect(h?.reigns.map(setText)).toEqual(["1 Sep or earlier", "1 Sep", "2 Sep"]);
  });

  test("how long each stood", () => {
    expect(h?.reigns.map(heldText)).toEqual(["under a day", "1 day", "holds it"]);
    // whole days: a day and a half stood one day
    const long = history([e(1, 1_000_000, 0, 11, 12), e(2, 900_000, 12)], 20);
    expect(long?.reigns.map(heldText)).toEqual(["1 day", "holds it"]);
  });

  test("a cut under a millisecond keeps its digits", () => {
    expect(cutText(21)).toBe("−0.00021s");
    expect(cutText(76_800)).toBe("−0.768s");
    expect(gapText(76_800)).toBe("0.768s");
  });

  test("the card's label", () => {
    expect(h && changesText(h)).toBe("World record · 2 changes since 1 Sep");
    const quiet = history([e(1, 1_000_000, 0)]);
    expect(quiet && changesText(quiet)).toBe("No changes since 1 Sep");
  });
});
