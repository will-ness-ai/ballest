// The Generators (spec #299): each makes a Prefab file from a few settings. Tested through
// generate() and each Generator's controls, the way the page drives them.
import qrcode from "qrcode-generator";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MakeGallery } from "../components/prefabs/make/MakeGallery";

import {
  COLOUR_NAMES,
  GENERATORS,
  PIECE_LIMIT,
  PIXEL_LETTERING,
  generate,
  generatorOf,
  voxelBoxes,
  voxelTree,
  VOXEL_KINDS,
  type Values,
} from "../lib/generators";
import { UNKNOWN_COLOUR, shapesOf, type PrefabFile, type PrefabItem } from "../lib/prefab";
import { checkPrefab } from "../lib/prefab-check";
import { GENERATOR_KEYS, generatorHref } from "../lib/routes";

const CUBE = 1000;
function gen(key: string) {
  const g = generatorOf(key);
  if (!g) throw new Error(`no Generator ${key}`);
  return g;
}
const valuesOf = (key: string, change: Values = {}): Values => ({
  ...gen(key).defaults,
  ...change,
});
function make(key: string, change: Values = {}) {
  const file = generate(key, valuesOf(key, change));
  if (!file) throw new Error(`${key} made nothing`);
  return file;
}

/* a cube's extent across a sign or code (+Y, left to right for the camera that spawned it)
   and up it (z), in cm */
const extent = (it: PrefabItem) => {
  const [, y, z] = it.transform.location;
  const [, sy, sz] = it.transform.scale;
  return { x0: y - (sy * CUBE) / 2, x1: y + (sy * CUBE) / 2, z0: z, z1: z + sz * CUBE };
};
/* how far a cube stands out of a sign toward the camera (-X), in cm */
const proud = (it: PrefabItem) => -(it.transform.location[0] - (it.transform.scale[0] * CUBE) / 2);

describe("every Generator", () => {
  test.each(GENERATORS.map((g) => g.key))("%s's defaults make a file the game takes", (key) => {
    const file = make(key);
    expect(checkPrefab(JSON.stringify(file))).toEqual({ ok: true, pieces: file.items.length });
  });

  test.each(GENERATORS.map((g) => g.key))("%s's defaults sit inside its sliders", (key) => {
    const g = gen(key);
    /* every choice's controls: a tree style's sliders show only once it is picked */
    const choices = g
      .controls(g.defaults)
      .flatMap((c) => (c.kind === "choice" ? c.options.map((o) => ({ [c.key]: o })) : []));
    for (const pick of [{}, ...choices])
      for (const c of g.controls({ ...g.defaults, ...pick }))
        if (c.kind === "number") {
          const v = Number(g.defaults[c.key]);
          expect(v, c.key).toBeGreaterThanOrEqual(c.min);
          expect(v, c.key).toBeLessThanOrEqual(c.max);
        }
  });
});

describe("the QR code", () => {
  /* which of the code's cells a file raises, read back from its boxes: the plate is the first
     piece, every other box covers whole cells */
  function raised(file: PrefabFile, cells: number) {
    const [plate, ...boxes] = file.items;
    const p = extent(plate);
    const cell = (p.x1 - p.x0) / cells;
    const on = new Set<string>();
    for (const b of boxes) {
      const e = extent(b);
      for (let x = Math.round((e.x0 - p.x0) / cell); x < Math.round((e.x1 - p.x0) / cell); x++)
        for (let y = Math.round((p.z1 - e.z1) / cell); y < Math.round((p.z1 - e.z0) / cell); y++)
          on.add(`${x},${y}`);
    }
    return on;
  }

  test("raises exactly the dark modules, inside a two-module margin", () => {
    const text = "https://ballestrecords.com";
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const dark = new Set<string>();
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (q.isDark(r, c)) dark.add(`${c + 2},${r + 2}`);
    expect(raised(make("qr", { text }), n + 4)).toEqual(dark);
  });

  test("is as wide and as tall as its size", () => {
    const e = extent(make("qr", { size: 9 }).items[0]);
    expect(e.x1 - e.x0).toBeCloseTo(900);
    expect(e.z1 - e.z0).toBeCloseTo(900);
  });

  test("faces the camera it spawns in front of, its modules a quarter of one proud", () => {
    const [plate, ...modules] = make("qr", { size: 5 }).items;
    const side = (extent(plate).x1 - extent(plate).x0) / 29; /* 25 modules and the margin */
    for (const m of modules) expect(proud(m) - proud(plate)).toBeCloseTo(side / 4);
  });

  test("defaults to the site's address", () => {
    expect(gen("qr").defaults.text).toBe("https://ballestrecords.com");
  });

  test("makes nothing from no text", () => {
    expect(generate("qr", valuesOf("qr", { text: "" }))).toBeNull();
  });

  test("a code too big for the game says so", () => {
    const file = make("qr", { text: "x".repeat(2000) });
    expect(file.items.length).toBeGreaterThan(PIECE_LIMIT);
    expect(checkPrefab(JSON.stringify(file)).ok).toBe(false);
  });
});

describe("the sign", () => {
  /* the boxes in front of the wall (or every box with none), as extents */
  const letters = (file: PrefabFile, wall: boolean) =>
    (wall ? file.items.slice(1) : file.items).map(extent);

  test.each([
    [12, 4],
    [3, 10],
    [40, 1],
    [1, 0.5],
  ])("fits its letters inside a %s m by %s m wall", (width, height) => {
    const file = make("sign", { text: "Welcome to my map, friend", width, height });
    const wall = extent(file.items[0]);
    for (const l of letters(file, true)) {
      expect(l.x0).toBeGreaterThanOrEqual(wall.x0 - 0.01);
      expect(l.x1).toBeLessThanOrEqual(wall.x1 + 0.01);
      expect(l.z0).toBeGreaterThanOrEqual(wall.z0 - 0.01);
      expect(l.z1).toBeLessThanOrEqual(wall.z1 + 0.01);
    }
  });

  test("with the wall off is letters standing on the ground, no plate", () => {
    const on = make("sign", { wall: true });
    const off = make("sign", { wall: false });
    expect(off.items.length).toBe(on.items.length - 1);
    expect(Math.min(...off.items.map((it) => it.transform.location[2]))).toBeCloseTo(0);
  });

  test("hides the wall's colour when the wall is off, and Detail in the Pixel font", () => {
    const keys = (change: Values) =>
      gen("sign")
        .controls(valuesOf("sign", change))
        .map((ctl) => ctl.key);
    expect(keys({ wall: false })).not.toContain("back");
    expect(keys({ wall: true })).toContain("back");
    expect(keys({ font: "Pixel" })).not.toContain("detail");
    expect(keys({ font: "Bungee" })).toContain("detail");
  });

  test("letters an A in Pixel as its table draws it", () => {
    const grid = PIXEL_LETTERING.grid(["A"]) ?? { w: 0, h: 0, on: () => false };
    const rows = Array.from({ length: grid.h }, (_, y) =>
      Array.from({ length: grid.w }, (_, x) => (grid.on(x, y) ? "#" : ".")).join(""),
    );
    expect(rows).toEqual([".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]);
  });

  test("makes nothing from no text", () => {
    expect(generate("sign", valuesOf("sign", { text: "   " }))).toBeNull();
  });
});

describe("the tree and the bush", () => {
  const cases: Array<[string, Values]> = [
    ["tree", { style: "Branches" }],
    ["tree", { style: "Tiers", "t.snow": true }],
    ["tree", { style: "Voxel", "v.kind": "Oak" }],
    ["tree", { style: "Voxel", "v.kind": "Birch" }],
    ["tree", { style: "Voxel", "v.kind": "Spruce" }],
    ["tree", { style: "Voxel", "v.kind": "Jungle" }],
    ["bush", {}],
  ];

  test.each(cases)(
    "%s %o is the same for the same seed and passes the game's check",
    (key, change) => {
      const a = make(key, { ...change, seed: 42 });
      expect(make(key, { ...change, seed: 42 })).toEqual(a);
      expect(checkPrefab(JSON.stringify(a)).ok).toBe(true);
    },
  );

  test.each(cases)("%s %o changes with Shuffle", (key, change) => {
    expect(make(key, { ...change, seed: 1 })).not.toEqual(make(key, { ...change, seed: 2 }));
  });

  test.each(VOXEL_KINDS)("a voxel %s's boxes cover exactly its voxels", (kind) => {
    const values = valuesOf("tree", { style: "Voxel", "v.kind": kind, "v.cell": 100 });
    const vox = voxelTree(values);
    const covered = new Map<string, string>();
    for (const it of voxelBoxes(vox, 100)) {
      const [x, y, z] = it.transform.location;
      const [sx, sy] = it.transform.scale;
      const [w, d] = [Math.round((sx * CUBE) / 100), Math.round((sy * CUBE) / 100)];
      const x0 = Math.round(x / 100 - w / 2 + 0.5);
      const y0 = Math.round(y / 100 - d / 2 + 0.5);
      for (let i = 0; i < w; i++)
        for (let j = 0; j < d; j++) {
          const k = `${x0 + i},${y0 + j},${Math.round(z / 100)}`;
          expect(covered.has(k), k).toBe(false);
          covered.set(k, it.meshes[0].materials[0]);
        }
    }
    expect([...covered.keys()].sort()).toEqual([...vox.keys()].sort());
  });

  test("keeps each style's settings when the style changes", () => {
    const keys = (style: string) =>
      gen("tree")
        .controls(valuesOf("tree", { style }))
        .map((ctl) => ctl.key);
    expect(keys("Tiers")).toContain("t.tiers");
    expect(keys("Tiers")).not.toContain("b.levels");
    expect(keys("Branches")).toContain("b.levels");
  });
});

describe("colours", () => {
  /* pairs read from prefabs the editor saved (prefabs/samples) */
  test.each([
    ["Dark", "MI_Env_Dark_Smooth", "MaterialCategory_Smooth", 2],
    ["White", "MI_Env_White_Smooth", "MaterialCategory_Smooth", 1],
    ["Lime", "MI_Env_Lime_Smooth", "MaterialCategory_Smooth", 6],
  ])("%s is painted as the editor saves it", (colour, material, category, index) => {
    const item = make("qr", { back: colour }).items[0];
    expect(item.meshes[0].materials[0]).toMatch(new RegExp(`/${material}[.]${material}$`));
    expect(item.paint).toEqual({
      categories: [`/Game/Art/DataAssets/BallestMaterials/${category}.${category}`],
      colors: [index],
    });
  });

  test("the site's viewer draws every colour, each in a colour of its own", () => {
    const drawn = COLOUR_NAMES.map((name) => shapesOf(make("qr", { back: name }))[0].colour);
    expect(drawn).not.toContain(UNKNOWN_COLOUR);
    expect(new Set(drawn).size).toBe(COLOUR_NAMES.length);
  });
});

describe("the pages", () => {
  test("only the sign letters, so only its page loads the fonts", () => {
    expect(GENERATORS.filter((g) => g.lettered).map((g) => g.key)).toEqual(["sign"]);
  });

  test("link every Generator, in GENERATORS' order", () => {
    expect(GENERATORS.map((g) => g.key)).toEqual([...GENERATOR_KEYS]);
    expect(generatorHref("tree")).toBe("/prefabs/make/tree");
    expect(generatorHref("fence")).toBe("/prefabs/make");
  });

  test("Make your own shows the tabs and a card per Generator", () => {
    const html = renderToStaticMarkup(<MakeGallery />);
    expect(html).toContain('href="/prefabs"');
    expect(html).toMatch(/<a aria-current="page" href="\/prefabs\/make">Make your own<\/a>/);
    for (const g of GENERATORS) expect(html).toContain(`href="/prefabs/make/${g.key}"`);
  });
});
