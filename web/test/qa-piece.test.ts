import { describe, expect, it } from "vitest";

import { VIEWS, frameOf, overlap, project, rankRows } from "../scripts/qa/piece-math.mjs";

const bounds = { min: [-500, -250, 0], max: [500, 250, 100] } as const;

describe("frameOf", () => {
  it("centres on the bounds and fits the larger extent in 90% of the image", () => {
    expect(frameOf(bounds, "top")).toEqual({ cr: 0, cu: 0, span: 1000 / 0.9 });
    expect(frameOf(bounds, "front")).toEqual({ cr: 0, cu: 50, span: 500 / 0.9 });
    expect(frameOf(bounds, "side")).toEqual({ cr: 0, cu: 50, span: 1000 / 0.9 });
  });
});

describe("project", () => {
  it("maps each view's right and up axes to image column and row, up being smaller rows", () => {
    const size = 512;
    // the bounds' +X end on the top view sits at the right, 5% in from the edge
    expect(project([500, 0, 50], bounds, "top", size)[0]).toBeCloseTo(size * 0.95);
    // +Y is up on the top view: a smaller row than the centre
    expect(project([0, 250, 0], bounds, "top", size)[1]).toBeLessThan(size / 2);
    // +Y is right on the front view, +Z up
    const [col, row] = project([0, 250, 100], bounds, "front", size);
    expect(col).toBeCloseTo(size * 0.95);
    expect(row).toBeLessThan(size / 2);
  });

  it("names the three views the contract does", () => {
    expect(VIEWS.map((v) => v.name)).toEqual(["top", "front", "side"]);
  });
});

describe("overlap", () => {
  it("is the share of covered pixels both outlines cover", () => {
    const a = Uint8Array.from([1, 1, 0, 0]);
    const b = Uint8Array.from([1, 0, 1, 0]);
    expect(overlap(a, b)).toBeCloseTo(1 / 3);
    expect(overlap(a, a)).toBe(1);
  });

  it("is 1 when neither covers anything, so an empty view doesn't drag a piece down", () => {
    expect(overlap(new Uint8Array(4), new Uint8Array(4))).toBe(1);
  });
});

describe("rankRows", () => {
  it("puts the worst-matching piece first and pieces with no reference last", () => {
    const rows = rankRows([
      { mesh: "A", scores: { top: 0.9, front: 0.95, side: 0.99 } },
      { mesh: "B", scores: null },
      { mesh: "C", scores: { top: 0.4, front: 0.8, side: 0.7 } },
    ]) as Array<{ mesh: string; worst: string }>;
    expect(rows.map((r) => [r.mesh, r.worst])).toEqual([
      ["C", "0.40"],
      ["A", "0.90"],
      ["B", "no ref"],
    ]);
  });
});
