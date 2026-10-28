// What `pnpm axi` makes of the test server itself: finding a channel by name, listing channels,
// and reading the arguments of `variants` and `ops --since`.
import { describe, expect, it } from "vitest";
import {
  ageOf,
  channelName,
  channelRows,
  findChannel,
  parseSince,
  parseVariants,
} from "../scripts/axi/server.js";

const OPS = { id: "1552729777029259470", name: "ops", type: 0, parent_id: "1552729777029259466" };
const CUP = { id: "1564575214484983829", name: "cup-check", type: 0 };
const CUP2 = { id: "1564575214484983830", name: "weekly-cup", type: 0 };
const CATEGORY = { id: "1552729777029259466", name: "Text Channels", type: 4 };
const FORUM = { id: "1561522772499501197", name: "r2-b-forum", type: 15 };

describe("finding a channel", () => {
  const all = [CATEGORY, OPS, CUP, CUP2, FORUM];

  it("takes a name with or without its #, in any case", () => {
    expect(findChannel("ops", all)).toEqual({ channel: OPS });
    expect(findChannel("#Cup-Check", all)).toEqual({ channel: CUP });
  });

  it("takes an id, even one the list doesn't hold (a thread)", () => {
    expect(findChannel("1564575214484983829", all)).toEqual({ channel: CUP });
    expect(findChannel("1599999999999999999", all)).toEqual({
      channel: { id: "1599999999999999999", name: "1599999999999999999", type: 11 },
    });
  });

  it("names the near misses when nothing matches, and never picks a category", () => {
    expect(findChannel("cup", all)).toEqual({ missing: "cup", near: ["cup-check", "weekly-cup"] });
    expect(findChannel("Text Channels", all)).toEqual({ missing: "Text Channels", near: [] });
  });
});

describe("listing channels", () => {
  const now = Date.UTC(2026, 9, 28, 3, 0);

  it("reads a post's age from its snowflake id", () => {
    // 1564830604850372659 was posted in the dev server's #ops at 2026-10-28 02:38 UTC.
    expect(ageOf("1564830604850372659", now)).toBe("21m");
    // 1561522772499501197 at 2026-10-18 23:34 UTC.
    expect(ageOf("1561522772499501197", now)).toBe("9d");
    expect(ageOf(undefined, now)).toBe("never");
  });

  it("lists text and forum channels by name, marking the ones outside every category", () => {
    const rows = channelRows(
      [
        CATEGORY,
        { ...OPS, last_message_id: "1564830604850372659" },
        { ...FORUM, last_message_id: "1561522772499501197" },
        { id: "2", name: "General", type: 2, parent_id: "1552729777029259466" },
      ],
      now,
    );
    expect(rows).toEqual([
      { name: "ops", kind: "text", last: "21m", loose: false },
      { name: "r2-b-forum", kind: "forum", last: "9d", loose: true },
    ]);
  });

  it("names a new channel as Discord will, so making it twice finds the first", () => {
    expect(channelName("Cup Check")).toBe("cup-check");
    expect(channelName("#axi-scratch")).toBe("axi-scratch");
  });
});

describe("variants", () => {
  it("reads each label=value pair in order", () => {
    expect(parseVariants(["A=scratch/a.png", "B=Just the text, with = in it"])).toEqual({
      variants: [
        { label: "A", value: "scratch/a.png" },
        { label: "B", value: "Just the text, with = in it" },
      ],
    });
  });

  it("refuses a pair without a label", () => {
    expect(parseVariants(["A=a.png", "b.png"])).toEqual({ bad: "b.png" });
    expect(parseVariants([])).toEqual({ bad: "" });
  });
});

describe("ops --since", () => {
  it("reads minutes, hours and days", () => {
    expect(parseSince("30m")).toBe(30 * 60_000);
    expect(parseSince("6h")).toBe(6 * 3_600_000);
    expect(parseSince("2d")).toBe(2 * 86_400_000);
  });

  it("refuses anything else", () => {
    expect(parseSince("6")).toBeNull();
    expect(parseSince("yesterday")).toBeNull();
  });
});
