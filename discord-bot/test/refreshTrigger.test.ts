import { describe, expect, it } from "@effect/vitest";
import { nextRefreshAt } from "../src/refreshTrigger.js";

const DAY0 = Date.UTC(2026, 9, 4);
const at = (h: number, m = 0) => DAY0 + (h * 60 + m) * 60_000;

describe("when the bot starts a Refresh", () => {
  it("every three hours, and at 15:30 UTC ahead of the Daily Report", () => {
    expect(nextRefreshAt(at(0))).toBe(at(3));
    expect(nextRefreshAt(at(1, 10))).toBe(at(3));
    expect(nextRefreshAt(at(15))).toBe(at(15, 30));
    expect(nextRefreshAt(at(15, 30))).toBe(at(18));
  });

  it("rolls over to midnight", () => {
    expect(nextRefreshAt(at(21, 1))).toBe(at(24));
  });
});
