import { describe, expect, it } from "vitest";

import {
  VIEWS,
  camera,
  frameOf,
  matching,
  overlap,
  pagesOf,
  rankRows,
} from "../scripts/qa/piece-math.mjs";

const bounds = { min: [-500, -250, 0], max: [500, 250, 100] } as const;

describe("frameOf", () => {
  it("centres on the bounds and fits the larger extent in 90% of the image", () => {
    expect(frameOf(bounds, "top")).toEqual({ cr: 0, cu: 0, span: 1000 / 0.9 });
    expect(frameOf(bounds, "front")).toEqual({ cr: 0, cu: 50, span: 500 / 0.9 });
    expect(frameOf(bounds, "side")).toEqual({ cr: 0, cu: 50, span: 1000 / 0.9 });
  });
});

describe("camera", () => {
  it("draws the views that map Unreal's left-handed axes as mirror images, flipped back", () => {
    // three's axes are Unreal's with y and z swapped, a reflection, so a view keeps its
    // handedness only if it was already a mirror in Unreal
    expect(VIEWS.map((v) => [v.name, camera(v).mirrored])).toEqual([
      ["top", true],
      ["front", false],
      ["side", true],
    ]);
    // its axes in three (metres, y up): the top view looks down from above
    expect(camera(VIEWS[0])).toMatchObject({ right: [-1, 0, 0], up: [0, 0, 1], toward: [0, 1, 0] });
  });

  it("names the three views the render script draws", () => {
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

describe("matching", () => {
  it("keeps the pieces whose mesh or stand-in matches, ignoring case", () => {
    const rows = [
      { mesh: "SM_Cone", kind: "cone" },
      { mesh: "Bevel_Half_SSurve", kind: "outline top+front" },
      { mesh: "SM_GoalRing", kind: "outline top" },
    ];
    const meshes = (pattern: string) => (matching(rows, pattern) as typeof rows).map((r) => r.mesh);
    expect(meshes("\\+")).toEqual(["Bevel_Half_SSurve"]);
    expect(meshes("cone|ring")).toEqual(["SM_Cone", "SM_GoalRing"]);
    expect(matching(rows, undefined)).toHaveLength(3);
  });
});

describe("the montage", () => {
  it("lays 16 pieces to a picture, worst first, so each stays readable", () => {
    const pages = pagesOf(Array.from({ length: 35 }, (_, i) => i)) as Array<Array<number>>;
    expect(pages.map((p) => p.length)).toEqual([16, 16, 3]);
    expect(pages[1][0]).toBe(16);
  });
});
