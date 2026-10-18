// What a Daily Post's card says, as pure data (spec #268): the Daily's number, the header, the
// podium with ties, the Medals line, and the thread's name. Real data: Daily #60, "the drop".
import { describe, expect, it } from "vitest";
import {
  cardText,
  closedText,
  dailyNumber,
  type DailyView,
  threadName,
} from "../src/dailyPost/card.js";
import { type Lead, leadChanged, leadLine, leadOf } from "../src/dailyPost/lead.js";
import { ticks } from "./harness.js";

const ENDS = Date.UTC(2026, 9, 19, 1);
const NOW = Date.UTC(2026, 9, 18, 17);

const view = (over: Partial<DailyView> = {}): DailyView => ({
  date: "2026-10-18",
  pfid: "3796494598",
  title: "the drop",
  maker: "AvgRon",
  endsAt: ENDS,
  medals: { bronze: 14, silver: 11, gold: 9, author: 8.9116315841674805 },
  board: {
    players: 145,
    top: [
      { name: "airman", ticks: ticks(8.532) },
      { name: "snayK", ticks: ticks(8.532) },
      { name: "FEDUS", ticks: ticks(8.566) },
    ],
  },
  readAt: NOW,
  ...over,
});

describe("a Daily Post's card", () => {
  it("numbers Dailies by date from 20 August 2026", () => {
    expect(dailyNumber("2026-08-20")).toBe(1);
    expect(dailyNumber("2026-10-18")).toBe(60);
    expect(dailyNumber("2027-01-01")).toBe(135);
  });

  it("heads the card with the number, the day, the Map and when it ends", () => {
    expect(cardText(view()).header).toBe(
      "-# DAILY #60 · SUN 18 OCT\n# the drop\nby **AvgRon** · ends <t:1792371600:R>",
    );
  });

  it("shows the player count, the fastest time and the top 3, ties sharing a place", () => {
    expect(cardText(view()).stats).toBe(
      "**145** players · fastest **0:08.532**\n🥇 **airman** 0:08.532\n🥇 **snayK** 0:08.532\n🥉 **FEDUS** 0:08.566",
    );
  });

  it("works with one time, and with none yet", () => {
    const one = view({ board: { players: 1, top: [{ name: "Water", ticks: ticks(9.1) }] } });
    expect(cardText(one).stats).toBe("**1** player · fastest **0:09.100**\n🥇 **Water** 0:09.100");
    expect(cardText(view({ board: { players: 0, top: [] } })).stats).toBe("No times yet");
    expect(cardText(view({ board: null })).stats).toBe("No times yet");
  });

  it("keeps names from pinging or breaking the markdown", () => {
    const sly = view({ board: { players: 1, top: [{ name: "@everyone *x*", ticks: ticks(9) }] } });
    expect(cardText(sly).stats).toContain("🥇 **@​everyone \\*x\\***");
  });

  it("ends with the Medal times and when it was updated", () => {
    expect(cardText(view()).foot).toBe(
      "Author 0:08.911 · Gold 0:09.000 · Silver 0:11.000 · Bronze 0:14.000\n-# Updated <t:1792342800:R>",
    );
  });

  it("shows times as the site does, cut to the thousandth rather than rounded", () => {
    const close = view({ board: { players: 1, top: [{ name: "Water", ticks: 853_299 }] } });
    expect(cardText(close).stats).toBe(
      "**1** player · fastest **0:08.532**\n🥇 **Water** 0:08.532",
    );
  });

  it("shares a place between times the site shows as equal, though Steam's ticks differ", () => {
    const close = view({
      board: {
        players: 3,
        top: [
          { name: "snayK", ticks: 853_201 },
          { name: "airman", ticks: 853_209 },
          { name: "FEDUS", ticks: ticks(8.566) },
        ],
      },
    });
    expect(cardText(close).stats).toContain("🥇 **snayK** 0:08.532\n🥇 **airman** 0:08.532\n🥉");
    expect(closedText(close).header).toContain("# 🏆 snayK & airman win\n");
  });

  it("names the thread after the Daily", () => {
    expect(threadName(view())).toBe("Daily #60 · the drop · Sun 18 Oct");
  });
});

describe("a closed Daily Post's card", () => {
  it("heads it with the winner, the winning time and the player count", () => {
    const one = view({
      board: {
        players: 145,
        top: [
          { name: "airman", ticks: ticks(8.532) },
          { name: "FEDUS", ticks: ticks(8.566) },
        ],
      },
    });
    expect(closedText(one).header).toBe(
      "-# DAILY #60 · SUN 18 OCT · the drop by AvgRon\n# 🏆 airman wins\n**0:08.532**, out of **145** players",
    );
    expect(closedText(one).stats).toBe("🥇 **airman** 0:08.532\n🥈 **FEDUS** 0:08.566");
  });

  it("names joint winners on a tie for first", () => {
    expect(closedText(view()).header).toContain("\n# 🏆 airman & snayK win\n");
    const three = view({
      board: { players: 3, top: ["a", "b", "c"].map((name) => ({ name, ticks: ticks(9) })) },
    });
    expect(closedText(three).header).toContain(
      "\n# 🏆 a, b & c win\n**0:09.000**, out of **3** players",
    );
  });

  it("says when it closed, under the Medals", () => {
    expect(closedText(view()).foot).toBe(
      "Author 0:08.911 · Gold 0:09.000 · Silver 0:11.000 · Bronze 0:14.000\n-# Closed <t:1792371600:f> · final",
    );
  });

  it("has no winner when nobody set a time", () => {
    const empty = closedText(view({ board: { players: 0, top: [] } }));
    expect(empty.header).toBe("-# DAILY #60 · SUN 18 OCT · the drop by AvgRon\n# No winner");
    expect(empty.stats).toBe("Nobody set a time");
    expect(closedText(view({ board: null })).stats).toBe("Nobody set a time");
  });

  it("keeps a winner's name from pinging or breaking the headline", () => {
    const sly = view({ board: { players: 1, top: [{ name: "@everyone *x*", ticks: ticks(9) }] } });
    expect(closedText(sly).header).toContain(
      "# 🏆 @​everyone \\*x\\* wins\n**0:09.000**, out of **1** player",
    );
  });
});

describe("a Daily Post's thread lines", () => {
  const H = 3_600_000;
  const OPEN = Date.UTC(2026, 9, 18, 1);
  const lead = (hours: number, leaders: ReadonlyArray<string>, seconds: number): Lead => ({
    at: OPEN + hours * H,
    leaders,
    ticks: ticks(seconds),
  });

  it("marks the first time", () => {
    expect(leadLine([], lead(0.4, ["MitchPlease"], 8.912))).toBe(
      "-# <t:1792286640:t> · 🏁 **MitchPlease** sets the first time: **0:08.912**",
    );
  });

  it("names who the lead was taken from, how long they held it, and by how much", () => {
    const history = [lead(0.4, ["MitchPlease"], 8.912)];
    expect(leadLine(history, lead(1.17, ["FEDUS"], 8.701))).toBe(
      "-# <t:1792289412:t> · 🏁 **FEDUS** takes the lead from **MitchPlease**, who held it for 46m · 0:08.912 → **0:08.701** (−0.211 s)",
    );
  });

  it("counts a Reign from when it began, through the holder's own faster times", () => {
    const history = [
      lead(0.4, ["MitchPlease"], 8.912),
      lead(1, ["FEDUS"], 8.701),
      lead(2, ["FEDUS"], 8.65),
    ];
    expect(leadLine(history, lead(4.25, ["airman"], 8.6))).toContain(
      "from **FEDUS**, who held it for 3h 15m · 0:08.650 → **0:08.600** (−0.050 s)",
    );
  });

  it("says a backfilled line was seen by a Refresh, not when it happened", () => {
    const history = [lead(0.4, ["MitchPlease"], 8.912)];
    expect(leadLine(history, lead(2, ["FEDUS"], 8.701), "byRefresh")).toBe(
      "-# by the <t:1792292400:t> Refresh · 🏁 **FEDUS** takes the lead from **MitchPlease**, who held it for 1h 36m · 0:08.912 → **0:08.701** (−0.211 s)",
    );
  });

  it("says nothing when the leader only beats their own time", () => {
    expect(leadLine([lead(1, ["FEDUS"], 8.701)], lead(2, ["FEDUS"], 8.65))).toBeNull();
  });

  it("posts a matched time as a tie", () => {
    const history = [lead(8, ["airman"], 8.532)];
    expect(leadLine(history, lead(12.5, ["airman", "snayK"], 8.532))).toBe(
      "-# <t:1792330200:t> · 🤝 **snayK** ties **airman** for the lead: **0:08.532**",
    );
  });

  it("posts a tie when the leader's new best is matched in the same read", () => {
    const history = [lead(8, ["airman"], 8.6)];
    expect(leadLine(history, lead(9, ["airman", "snayK"], 8.532))).toBe(
      "-# <t:1792317600:t> · 🤝 **snayK** ties **airman** for the lead: **0:08.532**",
    );
  });

  it("decides a tie on the time as shown, so a steal never reads −0.000 s", () => {
    const board = (top: ReadonlyArray<readonly [string, number]>) => ({
      players: 5,
      top: top.map(([name, t]) => ({ name, ticks: t })),
    });
    const before = leadOf(board([["airman", 853_209]]), OPEN + 8 * H);
    const after = leadOf(
      board([
        ["snayK", 853_201],
        ["airman", 853_209],
      ]),
      OPEN + 9 * H,
    );
    expect(after?.leaders).toEqual(["snayK", "airman"]);
    expect(leadLine([before!], after!)).toBe(
      "-# <t:1792317600:t> · 🤝 **snayK** ties **airman** for the lead: **0:08.532**",
    );
    // The leader shaving a tick off their own time changes nothing the card shows.
    expect(leadChanged(before!, leadOf(board([["airman", 853_201]]), OPEN + 9 * H)!)).toBe(false);
  });

  it("posts a newcomer at the same time as a tie, though a tied leader left", () => {
    const history = [lead(8, ["airman", "snayK"], 8.532)];
    expect(leadLine(history, lead(9, ["airman", "FEDUS"], 8.532))).toContain(
      "🤝 **FEDUS** ties **airman** & **snayK** for the lead",
    );
  });

  it("says nothing of a slower lead, as when a leader leaves the board", () => {
    expect(leadLine([lead(8, ["airman"], 8.5)], lead(9, ["snayK"], 8.6))).toBeNull();
  });

  it("names a tied leader left behind by the other's faster time", () => {
    const history = [lead(8, ["airman"], 8.6), lead(10, ["airman", "snayK"], 8.6)];
    expect(leadLine(history, lead(12, ["airman"], 8.5))).toContain(
      "🏁 **airman** takes the lead from **snayK**, who held it for 2h ·",
    );
  });

  it("takes a shared lead from everyone who shared it", () => {
    const history = [lead(8, ["airman"], 8.532), lead(12, ["airman", "snayK"], 8.532)];
    expect(leadLine(history, lead(14, ["FEDUS"], 8.5))).toContain(
      "🏁 **FEDUS** takes the lead from **airman** & **snayK**, who held it for 6h ·",
    );
    expect(leadLine(history, lead(14, ["snayK"], 8.5))).toContain(
      "🏁 **snayK** takes the lead from **airman**, who held it for 6h ·",
    );
  });
});
