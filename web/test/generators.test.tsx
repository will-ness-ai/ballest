// The Generators (spec #299): each makes a Prefab file from a few settings. Tested through
// generate() and each Generator's controls, the way the page drives them.
import qrcode from "qrcode-generator";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MakeGallery } from "../components/prefabs/make/MakeGallery";

import {
  CATEGORIES,
  COLOUR_NAMES,
  GENERATORS,
  PIECE_LIMIT,
  PIXEL_LETTERING,
  generate,
  generatorOf,
  variationsOf,
  voxelBoxes,
  voxelTree,
  VOXEL_KINDS,
  type Values,
} from "../lib/generators";
import {
  UNKNOWN_COLOUR,
  footprintOf,
  shapesOf,
  type PrefabFile,
  type PrefabItem,
} from "../lib/prefab";
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
    ["tree", {}],
    ["pine", { "t.snow": true }],
    ["block-tree", { "v.kind": "Oak" }],
    ["block-tree", { "v.kind": "Birch" }],
    ["block-tree", { "v.kind": "Spruce" }],
    ["block-tree", { "v.kind": "Jungle" }],
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
    const values = valuesOf("block-tree", { "v.kind": kind, "v.cell": 100 });
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

  test("each kind of tree is its own Generator, under Nature", () => {
    const keys = (key: string) =>
      gen(key)
        .controls(gen(key).defaults)
        .map((ctl) => ctl.key);
    expect(keys("tree")).toContain("b.levels");
    expect(keys("pine")).toContain("t.tiers");
    expect(keys("block-tree")).toContain("v.kind");
    for (const key of ["tree", "pine", "block-tree", "bush"])
      expect(gen(key).category).toBe("Nature");
  });
});

describe("buildings", () => {
  const tall = (key: string, change: Values) => footprintOf(shapesOf(make(key, change))).h;
  const isRound = (it: PrefabItem) => /BP_Prim_Cylinder|MP_Cone/.test(it.class);

  test("are House, Tower and Castle, under Buildings", () => {
    expect(GENERATORS.filter((g) => g.category === "Buildings").map((g) => g.key)).toEqual([
      "house",
      "tower",
      "castle",
    ]);
  });

  test("a house with more floors is taller, and a tower with more floors taller still", () => {
    expect(tall("house", { floors: 3 })).toBeGreaterThan(tall("house", { floors: 1 }) + 5);
    expect(tall("tower", { floors: 40 })).toBeGreaterThan(tall("tower", { floors: 10 }) + 50);
  });

  test("a castle without towers or a keep has no round pieces and no roofs", () => {
    const items = make("castle", { towers: false, keep: false, gate: 0 }).items;
    expect(items.filter(isRound)).toEqual([]);
    expect(items.filter((it) => it.class.includes("MP_Pyramid"))).toEqual([]);
  });

  test("a hip roof's pyramids are turned to the walls and cover the house", () => {
    const pyramids = make("house", { roof: "Hip", width: 12, depth: 8 }).items.filter((it) =>
      it.class.includes("MP_Pyramid"),
    );
    expect(pyramids).toHaveLength(2);
    for (const p of pyramids) {
      expect(p.transform.rotation[1]).toBe(45);
      /* SM_Pyramid is 500 cm across its corners; turned, its square side is that over √2 */
      expect((p.transform.scale[0] * 500) / Math.SQRT2).toBeGreaterThanOrEqual(800);
    }
  });

  /* a cube's span along each axis, in cm */
  const span = (it: PrefabItem) => {
    const [x, y, z] = it.transform.location;
    const [sx, sy, sz] = it.transform.scale.map((k) => k * CUBE);
    return { x0: x - sx / 2, x1: x + sx / 2, y0: y - sy / 2, y1: y + sy / 2, z0: z, z1: z + sz };
  };
  const coloured = (file: PrefabFile, material: string) =>
    file.items.filter(
      (it) => it.class.includes("BP_Prim_Cube") && it.meshes[0].materials[0].includes(material),
    );

  test.each([
    [4, 8, true],
    [4, 2, true],
    [9, 3, true],
    [30, 8, false],
  ])(
    "a %s m house's %s windows a side never overlap, and the door never meets one",
    (width, windows, door) => {
      const file = make("house", { width, depth: 4, windows, door, floors: 1 });
      const panes = coloured(file, "SkyBlue").map(span);
      const doorPanel = coloured(file, "Dark").find(
        (it) => span(it).z1 - span(it).z0 > 150 && span(it).z0 < 60,
      );
      expect(!!doorPanel).toBe(door);
      const W = width * 100;
      for (const [i, a] of panes.entries()) {
        expect(a.y0).toBeGreaterThanOrEqual(-W / 2);
        expect(a.y1).toBeLessThanOrEqual(W / 2);
        for (const b of panes.slice(i + 1))
          expect(
            a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0,
            "panes overlap",
          ).toBe(true);
        const doorway = doorPanel && span(doorPanel);
        if (doorway && a.x0 < -150)
          expect(a.y1 <= doorway.y0 || doorway.y1 <= a.y0, "a pane in the doorway").toBe(true);
      }
    },
  );

  test.each(["Gable", "Hip"])("a %s-roofed house's chimney stands above its roof", (roof) => {
    for (const [width, depth] of [
      [4, 30],
      [30, 4],
      [9, 7],
    ]) {
      const file = make("house", { roof, width, depth, chimney: true });
      const chimney = coloured(file, "Dark")
        .map(span)
        .find((b) => Math.abs(b.x1 - b.x0 - 60) < 1 && Math.abs(b.y1 - b.y0 - 60) < 1);
      /* the roof's highest point: each shape's centre plus its corners' reach upward */
      const roofShapes = shapesOf({
        ...file,
        items: file.items.filter((it) => it.meshes[0].materials[0].includes("Wine")),
      });
      /* the matrix takes a unit shape centred on the origin, so a corner is half each column */
      const reach = (m: Array<number>) => (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) / 2;
      const ridge = Math.max(...roofShapes.map((sh) => sh.matrix[13] + reach(sh.matrix))) * 100;
      expect(chimney?.z1 ?? 0, `${roof} ${width}x${depth}`).toBeGreaterThan(ridge);
    }
  });

  test("a castle's gate towers and battlements stay within its walls at any gate", () => {
    for (const [size, gate, merlons] of [
      [10, 10, 3],
      [10, 4, 0.7],
      [24, 4, 1],
    ]) {
      const S = size * 100;
      const file = make("castle", { size, gate, merlons, towers: false });
      for (const b of file.items.filter((it) => it.class.includes("BP_Prim_Cube")).map(span)) {
        expect(Math.max(-b.x0, b.x1, -b.y0, b.y1), `${size} m, gate ${gate} m`).toBeLessThanOrEqual(
          S / 2 + S * 0.15 + 1,
        );
        expect(Math.max(-b.y0, b.y1), `${size} m, gate ${gate} m`).toBeLessThanOrEqual(S / 2 + 60);
      }
    }
  });

  test.each(["house", "tower", "castle"])(
    "%s stays within the game's limit at its largest",
    (key) => {
      const g = gen(key);
      /* no pick, then each option of each choice these values show */
      const picksOf = (values: Values): Array<Values> => [
        {},
        ...g
          .controls(values)
          .flatMap((c) => (c.kind === "choice" ? c.options.map((o) => ({ [c.key]: o })) : [])),
      ];
      const most: Values = { ...g.defaults };
      for (const pick of picksOf(g.defaults))
        for (const c of g.controls({ ...g.defaults, ...pick }))
          if (c.kind === "number") most[c.key] = c.max;
      for (const pick of picksOf(most))
        expect(make(key, { ...most, ...pick }).items.length).toBeLessThanOrEqual(PIECE_LIMIT);
    },
  );
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

  test("Make your own puts each Generator under its category's heading, in order", () => {
    const html = renderToStaticMarkup(<MakeGallery />);
    const at = (s: string) => html.indexOf(s);
    expect(CATEGORIES.map((c) => at(`>${c}</h2>`))).toEqual(
      [...CATEGORIES.map((c) => at(`>${c}</h2>`))].sort((a, b) => a - b),
    );
    CATEGORIES.forEach((c, i) => {
      const from = at(`>${c}</h2>`);
      const to = i + 1 < CATEGORIES.length ? at(`>${CATEGORIES[i + 1]}</h2>`) : html.length;
      expect(from).toBeGreaterThan(0);
      for (const g of GENERATORS.filter((x) => x.category === c)) {
        const card = at(`href="/prefabs/make/${g.key}"`);
        expect(card, g.key).toBeGreaterThan(from);
        expect(card, g.key).toBeLessThan(to);
      }
    });
  });
});

describe("the collage's variations", () => {
  test("are the defaults, then each control pushed to each end, each option and each switch", () => {
    const rows = variationsOf(gen("castle"));
    const labels = rows.map((r) => r.label);
    expect(labels[0]).toBe("defaults");
    expect(labels).toContain("Size 10 m");
    expect(labels).toContain("Size 80 m");
    expect(labels).toContain("Corner towers off");
    expect(labels).not.toContain("Stone");
    const defaults = gen("castle").defaults;
    for (const { values } of rows)
      expect(
        Object.keys(values).filter((k) => values[k] !== defaults[k]).length,
      ).toBeLessThanOrEqual(1);
  });

  test("can be narrowed to some controls", () => {
    const rows = variationsOf(gen("house"), ["roof"]);
    expect(rows.map(([label]) => label)).toEqual([
      "defaults",
      "Roof Gable",
      "Roof Hip",
      "Roof Flat",
    ]);
  });

  test("each make a file within the game's limit, for every Generator", () => {
    for (const g of GENERATORS)
      for (const { label, values } of variationsOf(g)) {
        const file = generate(g.key, values);
        if (file) expect(file.items.length, `${g.key} ${label}`).toBeLessThanOrEqual(PIECE_LIMIT);
      }
  });
});
