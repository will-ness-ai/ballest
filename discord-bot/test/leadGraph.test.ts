// The Daily Post's lead graph, read from the scene before it is drawn. How it looks is checked by
// eye (`pnpm render:samples`, against the prototype's graph A); where each name sits is something
// a test can hold it to.
import { describe, expect, it } from "vitest";
import type { Lead } from "../src/dailyPost/lead.js";
import { type El, leadGraphScene } from "../src/render/scenes.js";
import { ticks } from "./harness.js";

const H = 3_600_000;
const OPENS = Date.UTC(2026, 9, 18, 1);
const lead = (hours: number, leaders: ReadonlyArray<string>, seconds: number): Lead => ({
  at: OPENS + hours * H,
  leaders,
  ticks: ticks(seconds),
});
const LEADS = [
  lead(0.4, ["MitchPlease"], 8.912),
  lead(1.2, ["FEDUS"], 8.701),
  lead(2.7, ["MitchPlease"], 8.64),
  lead(5.1, ["FEDUS"], 8.566),
  lead(8.3, ["airman"], 8.532),
  lead(12.8, ["airman", "snayK"], 8.532),
];

/** Every string in the scene, in order. */
const textsOf = (el: El): Array<string> =>
  (el.props.children ?? []).flatMap((c) =>
    c === null ? [] : typeof c === "string" ? [c] : textsOf(c),
  );

/** The absolutely placed box holding `text`. */
const boxOf = (el: El, text: string, at: El | null = null): El | null => {
  const here = el.props.style?.position === "absolute" ? el : at;
  for (const child of el.props.children ?? []) {
    if (child === text) return here;
    if (child !== null && typeof child !== "string") {
      const found = boxOf(child, text, here);
      if (found !== null) return found;
    }
  }
  return null;
};
const topOf = (el: El, text: string) => Number(boxOf(el, text)?.props.style?.top ?? NaN);

describe("the Daily Post's lead graph", () => {
  const live = leadGraphScene({
    opensAt: OPENS,
    closesAt: OPENS + 24 * H,
    leads: LEADS,
    now: OPENS + 16.3 * H,
  });

  it("names each step's leader under it, faster times lower", () => {
    const names = textsOf(live).filter((t) => ["MitchPlease", "FEDUS", "airman"].includes(t));
    expect(names).toEqual(["MitchPlease", "FEDUS", "MitchPlease", "FEDUS", "airman"]);
    expect(topOf(live, "FEDUS")).toBeGreaterThan(topOf(live, "MitchPlease"));
    expect(topOf(live, "airman")).toBeGreaterThan(topOf(live, "FEDUS"));
  });

  it("marks a tie, the current time and now while the Daily is live", () => {
    const texts = textsOf(live);
    expect(texts).toContain("snayK ties");
    expect(texts).toContain("0:08.532");
    expect(texts).toContain("now");
    const closed = leadGraphScene({
      opensAt: OPENS,
      closesAt: OPENS + 24 * H,
      leads: LEADS,
      now: null,
    });
    expect(textsOf(closed)).not.toContain("now");
  });

  it("colours leaders in the order they first led, a fifth in the neutral dim", () => {
    const five = ["A", "B", "C", "D", "E"].map((n, i) => lead(i + 1, [n], 9 - i * 0.1));
    const scene = leadGraphScene({
      opensAt: OPENS,
      closesAt: OPENS + 24 * H,
      leads: five,
      now: OPENS + 6 * H,
    });
    const svg = Buffer.from(
      JSON.stringify(scene).match(/data:image\/svg\+xml;base64,([^"]*)/)?.[1] ?? "",
      "base64",
    ).toString();
    const strokes = [...svg.matchAll(/<line [^>]*stroke="(#[0-9a-f]{6})" stroke-width="1.5"/g)].map(
      (m) => m[1],
    );
    expect(strokes).toEqual(["#3987e5", "#d95926", "#199e70", "#c98500", "#9aa3c7"]);
  });
});
