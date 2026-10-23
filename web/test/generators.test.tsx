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
  SPAWN_MOST,
  partsOf,
  MARBLE,
  PIXEL_LETTERING,
  generate,
  generatorOf,
  pictureOf,
  readPicture,
  rotOf,
  variationsOf,
  voxelBoxes,
  voxelTree,
  VOXEL_KINDS,
  type Values,
} from "../lib/generators";
import {
  UNKNOWN_COLOUR,
  footprintOf,
  rotationRows,
  shapesOf,
  type PrefabFile,
  type PrefabItem,
} from "../lib/prefab";
import { checkPrefab } from "../lib/prefab-check";
import { GENERATOR_KEYS, generatorHref } from "../lib/routes";

type V3 = [number, number, number];
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
/* the lowest any piece reaches, in cm: each shape's centre less its corners' reach downward
   (the matrix takes a unit shape centred on the origin, so a corner is half each column) */
const lowest = (file: PrefabFile) =>
  Math.min(
    ...shapesOf(file).map(
      (sh) =>
        sh.matrix[13] -
        (Math.abs(sh.matrix[1]) + Math.abs(sh.matrix[5]) + Math.abs(sh.matrix[9])) / 2,
    ),
  ) * 100;
const highest = (file: PrefabFile) =>
  Math.max(
    ...shapesOf(file).map(
      (sh) =>
        sh.matrix[13] +
        (Math.abs(sh.matrix[1]) + Math.abs(sh.matrix[5]) + Math.abs(sh.matrix[9])) / 2,
    ),
  ) * 100;
const count = (file: PrefabFile, piece: string) =>
  file.items.filter((it) => it.class.includes(piece)).length;

/* how far a cube stands out of a sign toward the camera (-X), in cm */
const proud = (it: PrefabItem) => -(it.transform.location[0] - (it.transform.scale[0] * CUBE) / 2);

/* every Generator but the trees and the bush: their sticks dip a little under the floor where
   they start, and a Tree with every slider at its most is 4,531 pieces, over the limit */
const BUILT = GENERATORS.filter((g) => g.category !== "Nature").map((g) => g.key);

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
  test.each(BUILT)("%s stays within the game's limit at its largest", (key) => {
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
  });

  test.each(BUILT)("%s never reaches under the floor", (key) => {
    for (const { label, values } of variationsOf(gen(key))) {
      const file = generate(key, values);
      if (file) expect(lowest(file), `${key} ${label}`).toBeGreaterThanOrEqual(-1);
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
});

describe("the pieces", () => {
  test.each([
    [
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 1, 0.3],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 0, -1],
    ],
    [
      [0.2, -0.7, -0.4],
      [0.5, 0.2, 0.8],
    ],
  ] as Array<[V3, V3]>)("rotOf(%o, %o) turns a piece's x and up that way", (f, u) => {
    const [x, , z] = rotationRows(rotOf(f, u));
    const n = (v: V3) => v.map((k) => k / Math.hypot(...v));
    n(f).forEach((k, i) => expect(x[i]).toBeCloseTo(k));
    /* up as near as it goes square to forward */
    const fu = n(f).reduce((a, k, i) => a + k * u[i], 0);
    const square = n(u.map((k, i) => k - fu * n(f)[i]) as V3);
    square.forEach((k, i) => expect(z[i]).toBeCloseTo(k));
  });
});

describe("the categories", () => {
  test("hold the Useful ones, then Racing, then Decor, each of the new five", () => {
    const under = (c: string) => GENERATORS.filter((g) => g.category === c).map((g) => g.key);
    expect(under("Useful")).toEqual([
      "qr",
      "sign",
      "arrow",
      "pixel-art",
      "stairs",
      "bridge",
      "floor-tiles",
    ]);
    expect(under("Racing")).toEqual([
      "straight",
      "corner",
      "banked",
      "s-bend",
      "t-junction",
      "spiral",
      "loop",
      "jump",
      "rollers",
      "course",
      "plinko",
    ]);
    expect(under("Decor")).toEqual(["lamp", "fountain", "trophy", "fence", "finish-arch"]);
  });
});

describe("the racing pieces", () => {
  test("a spiral with more turns is taller, and without walls is a third the pieces", () => {
    expect(highest(make("spiral", { turns: 4 }))).toBeGreaterThan(
      highest(make("spiral", { turns: 2 })) + 700,
    );
    const on = make("spiral", { walls: true, column: false });
    const off = make("spiral", { walls: false, column: false });
    expect(off.items.length * 3).toBe(on.items.length);
  });

  test("a loop's top is its diameter up, its surface there facing down", () => {
    const file = make("loop", { radius: 5, walls: false, lead: 0 });
    const top = file.items.reduce((a, b) =>
      b.transform.location[2] > a.transform.location[2] ? b : a,
    );
    expect(rotationRows(top.transform.rotation)[2][2]).toBeLessThan(-0.9);
    expect(highest(file)).toBeGreaterThan(1000);
    expect(highest(file)).toBeLessThan(1000 + 100);
  });

  test("a jump with a wider gap is longer", () => {
    const long = (change: Values) => footprintOf(shapesOf(make("jump", change))).w;
    expect(long({ gap: 12 })).toBeCloseTo(long({ gap: 6 }) + 6, 0);
  });

  test("a plinko board's pegs grow in number as they close up, and stay on the board", () => {
    expect(count(make("plinko", { spacing: 0.8 }), "Cylinder")).toBeGreaterThan(
      count(make("plinko", { spacing: 1.6 }), "Cylinder") * 3,
    );
    for (const it of make("plinko", { width: 5, spacing: 0.7 }).items)
      if (it.class.includes("Cylinder"))
        expect(Math.abs(it.transform.location[1])).toBeLessThan(250);
  });

  test("rollers rise to their bump height and have a piece more for each bump", () => {
    const file = make("rollers", { height: 2, bumps: 2, walls: false });
    /* the bumps over the track's 30 cm slab, its pieces' ends a little proud at the crests */
    expect(highest(file)).toBeGreaterThan(200 + 30);
    expect(highest(file)).toBeLessThan(200 + 30 + 30);
    expect(make("rollers", { bumps: 6, walls: false }).items.length).toBe(
      make("rollers", { bumps: 5, walls: false }).items.length + 10,
    );
  });
});

describe("the track pieces", () => {
  /* the track's slabs: the cubes as wide as the track, 30 cm deep */
  const slabs = (file: PrefabFile, width = 300) =>
    file.items.filter(
      (it) =>
        it.class.includes("Cube") &&
        Math.abs(it.transform.scale[1] * CUBE - width) < 1 &&
        Math.abs(it.transform.scale[2] * CUBE - 30) < 1,
    );
  const upOf = (it: PrefabItem) => rotationRows(it.transform.rotation)[2];

  test("a straight that rises stands its far end that much higher, flat at both ends", () => {
    const flat = make("straight", { walls: false });
    const ramp = make("straight", { walls: false, rise: 4 });
    expect(highest(ramp) - highest(flat)).toBeCloseTo(400, -1);
    const s = slabs(ramp);
    for (const end of [s[0], s[s.length - 1]]) expect(upOf(end)[2]).toBeGreaterThan(0.95);
  });

  test("a flat straight without walls is still two pieces, as the game spawns no fewer", () => {
    expect(make("straight", { walls: false }).items.length).toBe(2);
  });

  test("a rise stays within 45° however short the piece", () => {
    const most = (key: string, change: Values) => {
      const c = gen(key)
        .controls(valuesOf(key, change))
        .find((x) => x.key === "rise");
      return c?.kind === "number" ? c.max : NaN;
    };
    expect(most("straight", { length: 2 })).toBeLessThanOrEqual((2 * 2) / Math.PI);
    /* a bend rises evenly round its centreline, 2 m out a quarter turn */
    expect(most("corner", { radius: 2, angle: 90 })).toBeLessThanOrEqual(Math.PI);
    expect(most("banked", { radius: 3, angle: 30 })).toBeLessThanOrEqual(Math.PI / 2);
    const steep = make("corner", { radius: 2, angle: 15, rise: 10, walls: false });
    expect(highest(steep)).toBeLessThan(100);
  });

  test("a corner to the right is a corner to the left seen in a mirror", () => {
    const box = (turn: string) => footprintOf(shapesOf(make("corner", { turn })));
    const [l, r] = [box("Left"), box("Right")];
    expect(r.w).toBeCloseTo(l.w);
    expect(r.d).toBeCloseTo(l.d);
    const ys = (turn: string) =>
      slabs(make("corner", { turn, walls: false })).map((it) => it.transform.location[1]);
    /* the editor's camera looks along +X with +Y on its right */
    expect(Math.max(...ys("Right"))).toBeGreaterThan(500);
    expect(Math.min(...ys("Left"))).toBeLessThan(-500);
  });

  test("a banked turn tips in toward its middle, and lies flat where it starts and ends", () => {
    const s = slabs(make("banked", { walls: false, bank: 40 }));
    expect(upOf(s[0])[2]).toBeGreaterThan(0.97);
    expect(upOf(s[s.length - 1])[2]).toBeGreaterThan(0.97);
    expect(upOf(s[Math.floor(s.length / 2)])[2]).toBeCloseTo(Math.cos((40 * Math.PI) / 180), 1);
  });

  test("an S-bend comes out to the side by its shift", () => {
    const ys = (shift: number) =>
      slabs(make("s-bend", { walls: false, shift })).map((it) => it.transform.location[1]);
    /* a slab stands at its middle, so the first and last stand a little in from the ends */
    expect(Math.max(...ys(5)) - Math.min(...ys(5))).toBeGreaterThan(470);
    expect(Math.max(...ys(5)) - Math.min(...ys(5))).toBeLessThan(500);
    expect(Math.min(...ys(-5))).toBeLessThan(-450);
  });

  test("a T junction has a post only when asked, and its arms reach out both ways", () => {
    expect(count(make("t-junction", { post: true }), "Cylinder")).toBe(1);
    expect(count(make("t-junction", { post: false }), "Cylinder")).toBe(0);
    const d = footprintOf(shapesOf(make("t-junction", { arm: 8 }))).d;
    expect(d).toBeGreaterThan(16);
  });

  test("a raised piece stands on legs with its lowest track that high", () => {
    const file = make("corner", { raised: 5, rise: -2, walls: false });
    expect(count(file, "Cylinder")).toBeGreaterThan(2);
    const bottoms = slabs(file).map((it) => it.transform.location[2]);
    expect(Math.min(...bottoms)).toBeGreaterThan(495);
    expect(Math.min(...bottoms)).toBeLessThan(530);
    expect(count(make("corner", { raised: 0 }), "Cylinder")).toBe(0);
  });
});

describe("a big Prefab in parts", () => {
  /* the game slides each spawned Prefab along X so its nearest face lands a set way in front of
     the camera, so every part must reach as near as the whole does */
  const nearest = (file: PrefabFile) =>
    Math.min(
      ...shapesOf(file).map(
        (sh) =>
          sh.matrix[12] -
          (Math.abs(sh.matrix[0]) + Math.abs(sh.matrix[4]) + Math.abs(sh.matrix[8])) / 2,
      ),
    );

  test("a small one is one part, itself", () => {
    const file = make("corner");
    expect(partsOf(file)).toEqual([file]);
  });

  test("a big one splits into parts the game can spawn, each reaching as near and as low", () => {
    const file = make("course");
    const parts = partsOf(file);
    expect(parts.length).toBe(Math.ceil(file.items.length / SPAWN_MOST));
    for (const p of parts) {
      expect(p.items.length).toBeLessThanOrEqual(SPAWN_MOST + 1);
      expect(nearest(p)).toBeCloseTo(nearest(file), 2);
      expect(lowest(p)).toBeCloseTo(lowest(file), 0);
      expect(checkPrefab(JSON.stringify(p)).ok).toBe(true);
    }
    /* every piece once, and at most a marker more in each part */
    const all = parts.flatMap((p) => p.items);
    for (const it of file.items) expect(all).toContain(it);
    expect(all.length).toBeLessThanOrEqual(file.items.length + parts.length);
  });
});

describe("the decor", () => {
  test("lamps come one post each", () => {
    for (const style of ["Street", "Lantern", "Globe", "Double"]) {
      const posts = (n: number) =>
        make("lamp", { style, count: n }).items.filter(
          (it) => it.class.includes("Cylinder") && it.transform.scale[2] * 200 >= 490,
        ).length;
      expect(posts(4), style).toBe(4);
    }
  });

  test("a street lamp's shade is a cone wide at the bottom, over its bulb", () => {
    const items = make("lamp", { style: "Street" }).items;
    const shade = items.find((it) => it.class.includes("MP_Cone"));
    expect(shade?.transform.rotation).toEqual([0, 0, 0]);
    const bulb = items.find((it) => it.class.includes("Sphere"));
    expect(shade?.transform.location[2]).toBeGreaterThan(bulb?.transform.location[2] ?? 0);
  });

  test("a fountain of one tier has no column, and more tiers stand taller", () => {
    expect(highest(make("fountain", { tiers: 3, jet: false }))).toBeGreaterThan(
      highest(make("fountain", { tiers: 1, jet: false })) + 100,
    );
    expect(
      make("fountain", { tiers: 1, jet: false }).items.some((it) => it.class.includes("Cone")),
    ).toBe(false);
  });

  test("a trophy is as tall as asked, a ball on top has no cup, and no handles is fewer sticks", () => {
    expect(highest(make("trophy", { height: 5 }))).toBeCloseTo(500, -1);
    expect(count(make("trophy", { top: "Ball" }), "MP_Cone")).toBe(0);
    expect(count(make("trophy", { handles: false }), "Cylinder")).toBe(
      count(make("trophy", { handles: true }), "Cylinder") - 12,
    );
  });

  test("a pen is four sides, with a gate gap in the front's middle", () => {
    const pen = make("fence", { shape: "Pen", style: "Wall", length: 10, gate: true });
    const front = pen.items.filter((it) => it.transform.location[0] < -400);
    for (const it of front) {
      const [, y] = it.transform.location;
      const half = (it.transform.scale[1] * CUBE) / 2;
      expect(Math.abs(y) - half, "a piece in the gateway").toBeGreaterThanOrEqual(99);
    }
    expect(footprintOf(shapesOf(pen)).d).toBeGreaterThan(10);
  });

  test("an arch's banner has every other check, on both faces", () => {
    const file = make("finish-arch", { width: 8, banner: 1, rows: 2, flags: false });
    const checks = file.items.filter((it) => Math.abs(it.transform.scale[0] * CUBE - 4) < 0.01);
    expect(checks).toHaveLength(2 * 16);
  });
});

describe("the useful ones", () => {
  /* a sign's raised cells, as their spans across it */
  const across = (file: PrefabFile) =>
    file.items
      .slice(1)
      .map((it) => extent(it))
      .map((e) => [Math.round(e.x0), Math.round(e.x1), Math.round(e.z0)].join());
  const mirrored = (file: PrefabFile) =>
    file.items
      .slice(1)
      .map((it) => extent(it))
      .map((e) => [Math.round(-e.x1), Math.round(-e.x0), Math.round(e.z0)].join());

  test("an arrow pointing left is one pointing right, mirrored", () => {
    for (const shape of ["Arrow", "Turn", "U-turn", "Chevrons"])
      expect(new Set(across(make("arrow", { shape, points: "Left", detail: 20 }))), shape).toEqual(
        new Set(mirrored(make("arrow", { shape, points: "Right", detail: 20 }))),
      );
  });

  test("a picture reads back as it was written, each colour the nearest", () => {
    const rgba = [255, 255, 255, 255, 0, 0, 0, 0, 216, 67, 58, 255, 155, 226, 45, 255];
    const pic = readPicture(pictureOf(rgba, 2, 2));
    expect(pic && [pic.at(0, 0), pic.at(1, 0), pic.at(0, 1), pic.at(1, 1)]).toEqual([
      "White",
      null,
      "Red",
      "Lime",
    ]);
    expect(readPicture("3x3:abc")).toBeNull();
  });

  test("pixel art's blocks cover the picture's cells, and only those", () => {
    const pic = readPicture(MARBLE);
    if (!pic) throw new Error("no marble");
    let cells = 0;
    for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) if (pic.at(x, y)) cells++;
    const area = make("pixel-art", { across: 16, block: 10 })
      .items.map((it) => extent(it))
      .reduce((a, e) => a + ((e.x1 - e.x0) * (e.z1 - e.z0)) / 100, 0);
    expect(area).toBeCloseTo(cells);
  });

  test("pixel art laid on the floor lies flat, a block deep", () => {
    expect(highest(make("pixel-art", { lay: "On the floor", block: 20 }))).toBeCloseTo(20);
  });

  test("stairs climb to their height in steps of about their step height", () => {
    for (const shape of ["Straight", "Spiral"]) {
      const file = make("stairs", { shape, height: 3, rise: 20, rails: false });
      expect(count(file, "Cube"), shape).toBe(15);
      expect(highest(file), shape).toBeCloseTo(300, -1);
    }
  });

  test("an arched bridge rises to its arch height in the middle", () => {
    const file = make("bridge", { style: "Arch", span: 20, rise: 3, rails: false });
    expect(highest(file)).toBeGreaterThan(300);
    expect(highest(file)).toBeLessThan(300 + 40);
    expect(Math.max(footprintOf(shapesOf(file)).w, footprintOf(shapesOf(file)).d)).toBeGreaterThan(
      19.9,
    );
  });

  test("a checker is a tile each, stripes a strip a row", () => {
    expect(make("floor-tiles", { pattern: "Checker", across: 6, deep: 5 }).items).toHaveLength(30);
    expect(make("floor-tiles", { pattern: "Stripes", across: 6, deep: 5 }).items).toHaveLength(5);
    const box = footprintOf(shapesOf(make("floor-tiles", { across: 8, deep: 4, tile: 2 })));
    expect([box.w, box.d].sort((a, b) => a - b)).toEqual([8, 16]);
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
    expect(generatorHref("windmill")).toBe("/prefabs/make");
  });

  test("Generate your own shows the tabs and a card per Generator", () => {
    const html = renderToStaticMarkup(<MakeGallery />);
    expect(html).toContain('href="/prefabs"');
    expect(html).toMatch(/<a aria-current="page" href="\/prefabs\/make">Generate your own<\/a>/);
    for (const g of GENERATORS) expect(html).toContain(`href="/prefabs/make/${g.key}"`);
  });

  test("Generate your own puts each Generator under its category's heading, in order", () => {
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
    expect(rows.map((r) => r.label)).toEqual(["defaults", "Roof Gable", "Roof Hip", "Roof Flat"]);
  });

  test("each make a file within the game's limit, for every Generator", () => {
    for (const g of GENERATORS)
      for (const { label, values } of variationsOf(g)) {
        const file = generate(g.key, values);
        if (file) expect(file.items.length, `${g.key} ${label}`).toBeLessThanOrEqual(PIECE_LIMIT);
      }
  });
});
