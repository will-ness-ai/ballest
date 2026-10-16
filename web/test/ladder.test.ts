// What /you shows of one Workshop standing (lib/ladder.ts): the ladder card's rows around You,
// the line under it, the slices "Show all" reads, and how a shared place reads. The lists go
// in as GET /api/standings serves them; every expected value is worked out by hand.
import { describe, expect, test } from "vitest";

import { chaseText, ladderOf, placeText, sliceOf } from "../lib/ladder";
import type { StandingsStat, WorkshopStandingRow, WorkshopStandings } from "../lib/rows";

/* Players "a", "b", ... on Maps played, in listing order, each [count now, count at the
   baseline]; places are worked out the way the counting module gives them (1 + the players
   strictly higher), on both sides */
function played(counts: ReadonlyArray<[number, number]>): WorkshopStandings {
  const ids = counts.map((_, i) => String.fromCharCode(97 + i));
  const placeOf = (side: 0 | 1, n: number) =>
    1 + counts.filter((c) => c[side] > n).length;
  const rows = counts.map(
    ([now, then], i): WorkshopStandingRow => [i, now, then, placeOf(0, now), placeOf(1, then)],
  );
  return {
    readAt: "2026-10-16T12:00:00.000Z",
    since: "2026-10-14T16:00:00.000Z",
    maps: 100,
    players: ids.map((id): [string, string] => [id, id.toUpperCase()]),
    lists: { played: rows, author: [], wr: [], top5: [] },
  };
}

/* the steam IDs of a ladder's rows, "|" for the gap */
const shape = (s: WorkshopStandings, you: string | null) =>
  ladderOf(s, "played", you)
    .rows.map((r) => (r ? r.steamId : "|"))
    .join("");

/* twenty players, 20 Maps down to 1, nobody tied, nobody moved */
const twenty = played(Array.from({ length: 20 }, (_, i): [number, number] => [20 - i, 20 - i]));

describe("a ladder's rows", () => {
  test("mid-table: the top 3, a gap, two above You, You and one below", () => {
    expect(shape(twenty, "l")).toBe("abc|jklm");
  });

  test("in or near the top 5: unbroken from 1st to the row below You", () => {
    expect(shape(twenty, "a")).toBe("abcde");
    expect(shape(twenty, "d")).toBe("abcde");
    expect(shape(twenty, "e")).toBe("abcdef");
    // a gap there would hide only "d"
    expect(shape(twenty, "g")).toBe("abcdefgh");
    expect(shape(twenty, "h")).toBe("abc|fghi");
  });

  test("last on the list: nobody below", () => {
    expect(shape(twenty, "t")).toBe("abc|rst");
  });

  test("not on the list, or nobody signed in: the top 3", () => {
    expect(shape(twenty, "zz")).toBe("abc");
    expect(shape(twenty, null)).toBe("abc");
    expect(ladderOf(twenty, "played", "zz").you).toBeNull();
  });

  test("a list of one or two", () => {
    const two = played([
      [3, 3],
      [1, 1],
    ]);
    expect(shape(two, "b")).toBe("ab");
    expect(shape(two, null)).toBe("ab");
    expect(ladderOf(two, "played", "b").total).toBe(2);
    expect(shape(played([]), "a")).toBe("");
  });

  test("a player down to 0 has dropped off the list", () => {
    const s = played([
      [2, 2],
      [1, 0],
      [0, 1],
    ]);
    expect(shape(s, "c")).toBe("ab");
    expect(ladderOf(s, "played", "c")).toMatchObject({ total: 2, you: null });
  });
});

describe("a ladder row", () => {
  test("carries the gain and the places climbed since the baseline", () => {
    // a passed b; c is new to the list
    const s = played([
      [5, 3],
      [4, 4],
      [2, 0],
    ]);
    expect(ladderOf(s, "played", "c").rows).toEqual([
      { steamId: "a", persona: "A", n: 5, gain: 2, place: 1, shared: false, move: 1 },
      { steamId: "b", persona: "B", n: 4, gain: 0, place: 2, shared: false, move: -1 },
      { steamId: "c", persona: "C", n: 2, gain: 2, place: 3, shared: false, move: null },
    ]);
  });

  test("says when its place is shared", () => {
    const s = played([
      [5, 5],
      [3, 3],
      [3, 3],
      [1, 1],
    ]);
    expect(ladderOf(s, "played", null).rows.map((r) => r && [r.place, r.shared])).toEqual([
      [1, false],
      [2, true],
      [2, true],
    ]);
  });
});

describe("a place", () => {
  test("reads as an ordinal, with = when shared", () => {
    expect(placeText({ place: 1, shared: false })).toBe("1st");
    expect(placeText({ place: 1840, shared: true })).toBe("=1,840th");
    expect(placeText({ place: 12, shared: true })).toBe("=12th");
    expect(placeText({ place: 22, shared: false })).toBe("22nd");
  });
});

describe("Show all's slices", () => {
  test("a run of the list in listing order, and how many are on it", () => {
    const s = sliceOf(twenty, "played", 18, 50);
    expect(s.total).toBe(20);
    expect(s.rows.map((r) => r.steamId)).toEqual(["s", "t"]);
    expect(sliceOf(twenty, "played", 0, 2).rows.map((r) => r.place)).toEqual([1, 2]);
    expect(sliceOf(twenty, "played", 40, 5).rows).toEqual([]);
  });
});

describe("the line under a card", () => {
  const line = (s: WorkshopStandings, you: string | null, stat: StandingsStat = "played") =>
    chaseText(stat, ladderOf(s, stat, you).chase);

  test("how many more pass the player above", () => {
    expect(line(twenty, "l")).toBe("2 Maps more to pass K");
    // level with the player listed above: one more passes them
    const tied = played([
      [5, 5],
      [3, 3],
      [3, 3],
    ]);
    expect(line(tied, "c")).toBe("1 Map more to pass B");
  });

  test("a leader's margin", () => {
    expect(line(twenty, "a")).toBe("You lead by 1 Map");
    const level = played([
      [4, 4],
      [4, 4],
    ]);
    expect(line(level, "a")).toBe("1 Map more to lead outright");
    expect(line(played([[2, 2]]), "a")).toBe("You lead");
  });

  test("not on the list: what gets You on it", () => {
    expect(line(twenty, "zz")).toBe("1 Map to get on this list");
    const s = { ...twenty, lists: { ...twenty.lists, wr: twenty.lists.played } };
    expect(line(s, "zz", "wr")).toBe("1 world record to get on this list");
    expect(chaseText("author", { to: "pass", more: 6, persona: "Action Jackson" })).toBe(
      "6 Author Medals more to pass Action Jackson",
    );
    expect(chaseText("top5", { to: "lead", by: 1 })).toBe("You lead by 1 top 5");
  });
});
