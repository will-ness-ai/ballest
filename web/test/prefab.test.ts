// A Prefab file read into what the viewer draws (lib/prefab.ts), and the upload check the
// browser and the server both run on one (lib/prefab-check.ts).
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { footprintOf, partsOf, pieceLabel, shapesOf, type PrefabFile } from "../lib/prefab";
import { MAX_BYTES, checkPrefab, fileNameOf } from "../lib/prefab-check";
import { galleryOf } from "../lib/prefabs";

const sample = (name: string) =>
  readFileSync(new URL(`../../prefabs/samples/${name}.json`, import.meta.url), "utf8");

const CUBE = "/Game/Blueprints/Editor/BP_Prim_Cube.BP_Prim_Cube_C";
const BOX = "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3";

/* a file of cubes, each [location cm, rotation [pitch, yaw, roll], scale] */
function cubes(...items: Array<[Array<number>, Array<number>, Array<number>]>): PrefabFile {
  return {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items: items.map(([location, rotation, scale]) => ({
      class: CUBE,
      transform: { location, rotation, scale },
      meshes: [{ mesh: BOX, materials: ["/Game/M/MI_Env_Lime.MI_Env_Lime"] }],
    })) as PrefabFile["items"],
  };
}

const near = (got: { w: number; d: number; h: number }, want: [number, number, number]) => {
  expect(got.w).toBeCloseTo(want[0]);
  expect(got.d).toBeCloseTo(want[1]);
  expect(got.h).toBeCloseTo(want[2]);
};

describe("a Prefab file", () => {
  test("the bench is 23 pipe tubes and 5 cubes", () => {
    const file = JSON.parse(sample("bench")) as PrefabFile;
    expect(partsOf(file)).toEqual([
      { piece: "BP_Pipe_Tube1", count: 23 },
      { piece: "BP_Prim_Cube", count: 5 },
    ]);
    expect(shapesOf(file)).toHaveLength(28);
  });

  test("an unscaled cube is 10 m a side and sits on the ground", () => {
    const [shape] = shapesOf(
      cubes([
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
      ]),
    );
    near(footprintOf([shape]), [10, 10, 10]);
    // three's y is up: the unit shape's centre lands 5 m above the pivot
    expect(shape.matrix[13]).toBeCloseTo(5);
    expect(shape.colour).not.toBe("#8a90a0");
  });

  test("yaw turns a long piece flat, pitch stands it up", () => {
    const long = (rotation: Array<number>) =>
      footprintOf(shapesOf(cubes([[0, 0, 0], rotation, [2, 1, 1]])));
    near(long([0, 0, 0]), [20, 10, 10]);
    near(long([0, 90, 0]), [10, 20, 10]);
    near(long([90, 0, 0]), [10, 10, 20]);
  });

  test("Unreal's y lands on three's z, so two pieces apart in y are deep, not tall", () => {
    const pair = cubes(
      [
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
      ],
      [
        [0, 2000, 0],
        [0, 0, 0],
        [1, 1, 1],
      ],
    );
    near(footprintOf(shapesOf(pair)), [10, 30, 10]);
  });
});

test("a piece reads as the editor's catalogue names it, without its blueprint prefix", () => {
  expect(pieceLabel("BP_Pipe_Tube1")).toBe("Pipe Tube 1");
  expect(pieceLabel("BP_Prim_Cube")).toBe("Cube");
  expect(pieceLabel("BP_Ramp_Curve_Long1")).toBe("Ramp Curve Long 1");
  expect(pieceLabel("Bevel_Full_Ring")).toBe("Bevel Full Ring");
});

describe("the upload check", () => {
  test("both samples pass, with their piece counts", () => {
    expect(checkPrefab(sample("bench"))).toEqual({ ok: true, pieces: 28 });
    expect(checkPrefab(sample("testparkhill"))).toEqual({ ok: true, pieces: 153 });
  });

  const problems = (text: string) => {
    const r = checkPrefab(text);
    return r.ok ? [] : r.problems;
  };
  const withFile = (patch: object) => JSON.stringify({ ...JSON.parse(sample("bench")), ...patch });

  test("each rule fails with its own sentence", () => {
    expect(problems("not json")).toEqual(["This isn't a JSON file."]);
    expect(problems(withFile({ format: "BallestMap" }))).toEqual([
      'It isn\'t a prefab: "format" should be "BallestPrefab".',
    ]);
    expect(problems(withFile({ version: 2 }))).toEqual([
      "It's a prefab version this site doesn't know yet (only version 1).",
    ]);
    expect(problems(withFile({ group: null }))).toEqual(["Its group transform is missing."]);
    expect(problems(withFile({ items: "x" }))).toEqual(["It has no pieces."]);
    const one = (JSON.parse(sample("bench")) as PrefabFile).items.slice(0, 1);
    expect(problems(withFile({ items: one }))).toEqual(["A prefab needs at least 2 pieces."]);
    const many = Array.from({ length: 4097 }, () => one[0]);
    expect(problems(withFile({ items: many }))).toEqual([
      "It has 4097 pieces; the game takes at most 4096.",
    ]);
    const start = [
      one[0],
      { ...one[0], class: "/Game/Blueprints/MP_PlayerStart.MP_PlayerStart_C" },
    ];
    expect(problems(withFile({ items: start }))).toEqual([
      "It contains the start pad, which the game won't spawn in a prefab.",
    ]);
    const odd = [one[0], { ...one[0], class: "/Game/BP_Nope.BP_Nope_C" }];
    expect(problems(withFile({ items: odd }))).toEqual([
      "Pieces the editor doesn't have: BP_Nope.",
    ]);
  });

  test("a file over 4 MB is refused before it is read", () => {
    expect(problems(" ".repeat(MAX_BYTES + 1))).toEqual(["The file is over 4 MB."]);
  });

  test("download names are what the game's spawn command accepts", () => {
    expect(fileNameOf("Park hill")).toBe("park_hill.json");
    expect(fileNameOf("  Loop-gate #2!  ")).toBe("loop-gate_2.json");
    expect(fileNameOf("😀😀")).toBe("prefab.json");
    expect(fileNameOf("a".repeat(80))).toBe("a".repeat(64) + ".json");
  });
});

describe("the gallery's order", () => {
  const card = (slug: string, favorites: number, createdAt: string, tags: Array<string> = []) => ({
    slug,
    favorites,
    createdAt,
    tags,
  });
  const cards = [
    card("old-hit", 9, "2026-10-01T00:00:00.000Z", ["Ramp"]),
    card("new-quiet", 0, "2026-10-15T00:00:00.000Z"),
    card("tie-newer", 3, "2026-10-12T00:00:00.000Z", ["Ramp", "Loop"]),
    card("tie-older", 3, "2026-10-10T00:00:00.000Z"),
  ];
  const slugs = (list: Array<{ slug: string }>) => list.map((c) => c.slug);

  test("Popular is most favorited first, newest breaking a tie", () => {
    expect(slugs(galleryOf(cards, "popular", null))).toEqual([
      "old-hit",
      "tie-newer",
      "tie-older",
      "new-quiet",
    ]);
  });

  test("Newest is by when it was uploaded", () => {
    expect(slugs(galleryOf(cards, "newest", null))).toEqual([
      "new-quiet",
      "tie-newer",
      "tie-older",
      "old-hit",
    ]);
  });

  test("a tag keeps only the Prefabs carrying it", () => {
    expect(slugs(galleryOf(cards, "popular", "Ramp"))).toEqual(["old-hit", "tie-newer"]);
    expect(slugs(galleryOf(cards, "popular", "Structure"))).toEqual([]);
  });
});
