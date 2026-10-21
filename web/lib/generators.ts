// The Generators (CONTEXT.md; spec #299): QR code, Sign, Tree and Bush, each making a Prefab
// file from a few settings. A Generator is its controls, its defaults and its builder; the
// page draws whatever controls() returns, so a new Generator is one entry in GENERATORS.
// Settled on the never-merged branch claude/prototype-prefab-generators.
//
// Pieces are the editor's primitives, placed by their bottom centre (lib/prefab-meshes.ts has
// their bounds): a cube 1000 cm, a sphere 400 cm, a cylinder 1000 cm across and 200 tall, a
// cone 300 across and 200 tall. Rotations are Unreal's [pitch, yaw, roll] in degrees. A sign
// or a QR code reads from +Y, so x runs left to right for someone standing there.
import qrcode from "qrcode-generator";

import type { PrefabFile, PrefabItem } from "./prefab";
import { PIXEL_LETTERING, wrapAt, type Grid, type Lettering } from "./generator-letters";

export type { Grid, Lettering } from "./generator-letters";
export { PIXEL_LETTERING } from "./generator-letters";

/* the most pieces spawnprefab takes (lib/prefab-check.ts) */
export const PIECE_LIMIT = 4096;

/* ---------- colours ---------- */
/* each colour the Generators offer: its material and the paint the editor saves beside it,
   a MaterialCategory and an EBallestMaterialColors value (read from the game's assets) */
const SMOOTH = "MaterialCategory_Smooth";
const SPECIAL = "MaterialCategory_Special";
const ENV = "/Game/Art/Materials/Environment/Materials/";
const smooth = (name: string, index: number) =>
  ({ material: `${ENV}Instances_2/MI_Env_${name}_Smooth`, category: SMOOTH, index }) as const;
const special = (name: string, index: number) =>
  ({ material: `${ENV}Instances/MI_Env_${name}`, category: SPECIAL, index }) as const;
export const COLOURS = {
  White: smooth("White", 1),
  Dark: smooth("Dark", 2),
  Red: smooth("Red", 3),
  Orange: smooth("Orange", 4),
  Yellow: smooth("Yellow", 5),
  Lime: smooth("Lime", 6),
  Blue: smooth("Blue", 8),
  "Sky blue": smooth("SkyBlue", 9),
  Purple: smooth("Purple", 10),
  Wine: smooth("Wine", 11),
  Iron: special("Iron", 12),
  Copper: special("Copper", 13),
  Aluminum: special("Aluminum", 14),
} as const;
export type Colour = keyof typeof COLOURS;
export const COLOUR_NAMES = Object.keys(COLOURS) as Array<Colour>;
const isColour = (c: unknown): c is Colour => typeof c === "string" && c in COLOURS;

/* ---------- pieces ---------- */
const PIECES =
  "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces";
const KINDS = {
  cube: {
    cls: `${PIECES}/BP_Prim_Cube.BP_Prim_Cube_C`,
    mesh: "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3",
    size: [1000, 1000, 1000],
  },
  sphere: {
    cls: `${PIECES}/BP_Prim_Sphere.BP_Prim_Sphere_C`,
    mesh: "/Game/Maps/_GENERATED/PC/SM_Sphere.SM_Sphere",
    size: [400, 400, 400],
  },
  cylinder: {
    cls: `${PIECES}/BP_Prim_Cylinder.BP_Prim_Cylinder_C`,
    mesh: "/Game/Maps/_GENERATED/PC/SM_Start_Fixed.SM_Start_Fixed",
    size: [1000, 1000, 200],
  },
  cone: {
    cls: "/Game/LevelEditor/PackageAssets/BallestAssets/MapPieces/MP_Cone.MP_Cone_C",
    mesh: "/Game/LevelEditor/PackageAssets/BallestAssets/MapPieces/Meshes/SM_Cone.SM_Cone",
    size: [300, 300, 200],
  },
} as const;
type Kind = keyof typeof KINDS;
type V3 = [number, number, number];

const tail = (path: string) => path.split("/").at(-1) ?? path;
const full = (path: string) => `${path}.${tail(path)}`;

/* a piece `size` cm across its own axes, its bottom centre at `at`, turned by `rot` (or a yaw) */
function piece(kind: Kind, at: V3, size: V3, colour: Colour, rot: V3 | number = 0): PrefabItem {
  const k = KINDS[kind];
  const c = COLOURS[colour];
  /* the keys the editor saves; PrefabItem names only the ones the viewer reads */
  const item = {
    class: k.cls,
    transform: {
      location: at,
      rotation: typeof rot === "number" ? ([0, rot, 0] as V3) : rot,
      scale: [size[0] / k.size[0], size[1] / k.size[1], size[2] / k.size[2]] as V3,
    },
    properties: {},
    meshes: [{ tag: "SKGMapEditor", mesh: k.mesh, materials: [full(c.material)] }],
    paint: {
      categories: [full(`/Game/Art/DataAssets/BallestMaterials/${c.category}`)],
      colors: [c.index],
    },
  };
  return item;
}

const fileOf = (items: Array<PrefabItem>): PrefabFile => ({
  format: "BallestPrefab",
  version: 1,
  group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
  items,
});

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const DEG = Math.PI / 180;

/* the [pitch, yaw, roll] that turns a piece's up axis along d */
function aim(d: V3): V3 {
  const [x, y, z] = norm(d);
  return [-Math.acos(Math.max(-1, Math.min(1, z))) / DEG, Math.atan2(y, x) / DEG, 0];
}
/* a cylinder from a to b, w cm thick */
const stick = (a: V3, b: V3, w: number, c: Colour) => {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return piece("cylinder", a, [w, w, Math.hypot(...d)], c, aim(d));
};
/* a sphere s cm across centred at p, squashed in height */
const ball = (p: V3, s: number, c: Colour, squash = 1) =>
  piece("sphere", [p[0], p[1], p[2] - (s * squash) / 2], [s, s, s * squash], c);

/* the grid's on cells as rectangles: runs along each row, stacked where rows agree */
export function rects(g: Grid): Array<{ x: number; y: number; w: number; h: number }> {
  const done = new Set<number>();
  const free = (x: number, y: number) => g.on(x, y) && !done.has(y * g.w + x);
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (!free(x, y)) continue;
      let w = 1;
      while (x + w < g.w && free(x + w, y)) w++;
      let h = 1;
      while (y + h < g.h && Array.from({ length: w }, (_, i) => free(x + i, y + h)).every(Boolean))
        h++;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) done.add((y + j) * g.w + x + i);
      out.push({ x, y, w, h });
    }
  return out;
}

/* the grid's on cells as boxes `cell` cm across, centred on x = 0 with row 0's top at `top`,
   `depth` thick from y = y0 */
function cellsOf(g: Grid, cell: number, top: number, y0: number, depth: number, c: Colour) {
  return rects(g).map((r) =>
    piece(
      "cube",
      [(-g.w / 2 + r.x + r.w / 2) * cell, y0 + depth / 2, top - (r.y + r.h) * cell],
      [r.w * cell, depth, r.h * cell],
      c,
    ),
  );
}

/* a small seeded random, so the same seed gives the same shape */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* a random point in the unit ball */
function inBall(r: () => number): V3 {
  const a = r() * Math.PI * 2;
  const u = r() * 2 - 1;
  const d = Math.cbrt(r());
  const s = Math.sqrt(1 - u * u);
  return [Math.cos(a) * s * d, Math.sin(a) * s * d, u * d];
}

/* a direction `angle` radians off d, `around` radians about it */
function turn(d: V3, angle: number, around: number): V3 {
  const [x, y, z] = norm(d);
  const ref: V3 = Math.abs(z) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm([y * ref[2] - z * ref[1], z * ref[0] - x * ref[2], x * ref[1] - y * ref[0]]);
  const w: V3 = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]];
  const s = Math.sin(angle);
  return norm(
    add(
      mul([x, y, z], Math.cos(angle)),
      add(mul(u, s * Math.cos(around)), mul(w, s * Math.sin(around))),
    ),
  );
}

/* ---------- controls ---------- */
export type Values = Record<string, string | number | boolean>;
interface Base {
  key: string;
  label: string;
  /* shown only under More options */
  more?: boolean;
}
export type Control = Base &
  (
    | { kind: "number"; min: number; max: number; step: number; unit?: string }
    | { kind: "colour" }
    | { kind: "choice"; options: ReadonlyArray<string> }
    | { kind: "toggle" }
    | { kind: "text"; lines?: number }
    | { kind: "font" }
    | { kind: "shuffle" }
  );

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
  more = false,
): Control => ({ key, label, kind: "number", min, max, step, unit, more });
const colour = (key: string, label: string): Control => ({ key, label, kind: "colour" });
const SHUFFLE: Control = { key: "seed", label: "Shuffle", kind: "shuffle" };

const n = (v: Values, k: string) => Number(v[k]);
const c = (v: Values, k: string): Colour => (isColour(v[k]) ? v[k] : "White");

export interface Generator {
  key: string;
  name: string;
  blurb: string;
  /* the stem of the file Download saves, and so of the spawn command */
  file: string;
  defaults: Values;
  /* the controls to show for these values (a switch can hide another's) */
  controls: (v: Values) => Array<Control>;
  build: (v: Values, lettering: Lettering) => PrefabFile | null;
}

/* ---------- QR code ---------- */
const qr: Generator = {
  key: "qr",
  name: "QR code",
  blurb: "A code players can scan, built from blocks.",
  file: "qr_code",
  defaults: { text: "https://ballestrecords.com", size: 6, back: "White", front: "Dark" },
  controls: () => [
    { key: "text", label: "Link or text", kind: "text" },
    num("size", "Size", 1, 60, 0.5, "m"),
    colour("back", "Background"),
    colour("front", "Code"),
  ],
  build: (v) => {
    const text = String(v.text);
    if (!text) return null;
    let q: ReturnType<typeof qrcode>;
    try {
      q = qrcode(0, "M");
      q.addData(text);
      q.make();
    } catch {
      return null;
    }
    const m = q.getModuleCount();
    const margin = 2;
    const grid: Grid = {
      w: m + margin * 2,
      h: m + margin * 2,
      on: (x, y) => {
        const [i, j] = [x - margin, y - margin];
        return i >= 0 && j >= 0 && i < m && j < m && q.isDark(j, i);
      },
    };
    const size = n(v, "size") * 100;
    const cell = size / grid.w;
    return fileOf([
      piece("cube", [0, 0, 0], [size, cell / 2, size], c(v, "back")),
      ...cellsOf(grid, cell, size, cell / 4, cell / 2, c(v, "front")),
    ]);
  },
};

/* ---------- sign ---------- */
/* the wrap of the text that makes its letters biggest inside w by h, and its grid's cell */
export function fitText(text: string, lettering: Lettering, w: number, h: number) {
  const t = text.trim();
  if (!t) return null;
  const longest = Math.max(...t.split(/\s+/).map((x) => x.length));
  let best: { lines: Array<string>; scale: number } | null = null;
  for (let per = longest; per <= Math.max(longest, t.length); per++) {
    const lines = wrapAt(t, per, lettering.keepsCase);
    const wide = Math.max(...lines.map((l) => lettering.width(l)));
    const scale = Math.min(w / wide, h / (lines.length * lettering.lineHeight));
    if (!best || scale > best.scale) best = { lines, scale };
  }
  if (!best) return null;
  const grid = lettering.grid(best.lines);
  if (!grid) return null;
  return { grid, cell: Math.min(w / grid.w, h / grid.h) };
}

const sign: Generator = {
  key: "sign",
  name: "Sign",
  blurb: "Your words in blocks, on a wall or standing alone.",
  file: "sign",
  defaults: {
    text: "Welcome to my map",
    font: "Pixel",
    detail: 14,
    width: 12,
    height: 4,
    wall: true,
    back: "White",
    front: "Dark",
  },
  controls: (v) => [
    { key: "text", label: "Text", kind: "text", lines: 3 },
    { key: "font", label: "Font", kind: "font" },
    ...(v.font === "Pixel" ? [] : [num("detail", "Detail", 5, 40, 1, "blocks", true)]),
    num("width", "Width", 1, 100, 0.5, "m"),
    num("height", "Height", 0.5, 50, 0.5, "m"),
    { key: "wall", label: "Wall behind the text", kind: "toggle" },
    ...(v.wall ? [colour("back", "Wall")] : []),
    colour("front", "Letters"),
  ],
  build: (v, lettering) => {
    const W = n(v, "width") * 100;
    const H = n(v, "height") * 100;
    const pad = v.wall ? 0.12 : 0;
    const fit = fitText(String(v.text), lettering, W * (1 - pad), H * (1 - pad));
    if (!fit) return null;
    const { grid, cell } = fit;
    const textH = grid.h * cell;
    if (!v.wall) return fileOf(cellsOf(grid, cell, textH, 0, cell, c(v, "front")));
    const depth = Math.max(5, Math.min(W, H) * 0.03);
    return fileOf([
      piece("cube", [0, 0, 0], [W, depth, H], c(v, "back")),
      ...cellsOf(grid, cell, H - (H - textH) / 2, depth / 2, cell / 2, c(v, "front")),
    ]);
  },
};

/* ---------- tree and bush ---------- */
/* a stick from `at` along `dir`, forking `levels` times into `forks` branches `angle` degrees
   out, each `ratio` as long; a clump of `balls` leaf balls `clump` cm across at every tip */
interface Branching {
  levels: number;
  forks: number;
  angle: number;
  ratio: number;
  clump: number;
  balls: number;
  bark: Colour;
  leaves: Colour;
}
function grow(
  b: Branching,
  r: () => number,
  items: Array<PrefabItem>,
  at: V3,
  dir: V3,
  len: number,
  width: number,
  level: number,
) {
  const end = add(at, mul(dir, len));
  items.push(stick(at, end, width, b.bark));
  if (level >= b.levels) {
    for (let i = 0; i < b.balls; i++)
      items.push(
        ball(add(end, mul(inBall(r), b.clump * 0.45)), b.clump * (0.6 + r() * 0.5), b.leaves, 0.8),
      );
    return;
  }
  const spin = r() * Math.PI * 2;
  for (let i = 0; i < b.forks; i++) {
    const d = turn(dir, b.angle * DEG * (0.8 + r() * 0.4), spin + (i / b.forks) * Math.PI * 2);
    grow(
      b,
      r,
      items,
      end,
      norm(add(d, [0, 0, 0.35])),
      (len * b.ratio) / 100,
      width * 0.62,
      level + 1,
    );
  }
}

const branchesTree = (v: Values) => {
  const items: Array<PrefabItem> = [];
  grow(
    {
      levels: n(v, "b.levels"),
      forks: n(v, "b.forks"),
      angle: n(v, "b.angle"),
      ratio: n(v, "b.ratio"),
      clump: n(v, "b.clump") * 100,
      balls: n(v, "b.balls"),
      bark: c(v, "bark"),
      leaves: c(v, "leaves"),
    },
    random(n(v, "seed")),
    items,
    [0, 0, 0],
    [0, 0, 1],
    n(v, "b.trunk") * 100,
    n(v, "b.girth") * 100,
    0,
  );
  return items;
};

const tiersTree = (v: Values) => {
  const r = random(n(v, "seed"));
  const H = n(v, "t.height") * 100;
  const W = n(v, "t.width") * 100;
  const stem = Math.min(n(v, "t.stem") * 100, H * 0.8);
  const k = n(v, "t.tiers");
  const ov = n(v, "t.overlap") / 100;
  const th = (H - stem) / (k - (k - 1) * ov);
  const items = [stick([0, 0, 0], [0, 0, stem + th * 0.5], W * 0.08, c(v, "bark"))];
  for (let i = 0; i < k; i++) {
    const w = W * (1 - ((n(v, "t.taper") / 100) * i) / Math.max(1, k - 1));
    const z = stem + i * th * (1 - ov);
    items.push(piece("cone", [0, 0, z], [w, w, th], c(v, "leaves"), r() * 360));
    if (v["t.snow"])
      items.push(
        piece("cone", [0, 0, z + th * 0.62], [w * 0.4, w * 0.4, th * 0.4], "White", r() * 360),
      );
  }
  return items;
};

/* voxels by "x,y,z", merged a layer at a time into boxes `cell` cm on a side */
export function voxelBoxes(vox: Map<string, Colour>, cell: number): Array<PrefabItem> {
  const at = [...vox.keys()].map((k) => k.split(",").map(Number));
  if (!at.length) return [];
  const [xs, ys, zs] = [0, 1, 2].map((i) => at.map((p) => p[i]));
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const w = Math.max(...xs) - x0 + 1;
  const h = Math.max(...ys) - y0 + 1;
  const items: Array<PrefabItem> = [];
  for (let z = Math.min(...zs); z <= Math.max(...zs); z++)
    for (const col of new Set(vox.values()))
      for (const b of rects({ w, h, on: (x, y) => vox.get(`${x + x0},${y + y0},${z}`) === col }))
        items.push(
          piece(
            "cube",
            [(b.x + x0 + b.w / 2 - 0.5) * cell, (b.y + y0 + b.h / 2 - 0.5) * cell, z * cell],
            [b.w * cell, b.h * cell, cell],
            col,
          ),
        );
  return items;
}

export const VOXEL_KINDS = ["Oak", "Birch", "Spruce", "Jungle"] as const;
/* a block-game tree's voxels: `height` blocks, a canopy `radius` blocks out, `holes` per cent
   of the leaves' outer shell missing */
export function voxelTree(v: Values): Map<string, Colour> {
  const r = random(n(v, "seed"));
  const H = n(v, "v.height");
  const R = n(v, "v.radius");
  const kind = String(v["v.kind"]);
  const vox = new Map<string, Colour>();
  const leaf = (x: number, y: number, z: number, edge: boolean) => {
    if (edge && r() * 100 < n(v, "v.holes")) return;
    vox.set(`${x},${y},${z}`, c(v, "leaves"));
  };
  if (kind === "Spruce")
    for (let z = 2; z <= H; z++) {
      const rad = Math.round(((H - z) / (H - 2)) * R * (z % 2 ? 1 : 0.7));
      for (let x = -rad; x <= rad; x++)
        for (let y = -rad; y <= rad; y++)
          if (Math.abs(x) + Math.abs(y) <= rad + 1) leaf(x, y, z, Math.abs(x) + Math.abs(y) >= rad);
    }
  else if (kind === "Jungle")
    for (const zc of [H - 2, Math.round(H * 0.6)])
      for (let z = zc; z <= zc + 1; z++) {
        const rad = z === zc ? R + 1 : R - 1;
        for (let x = -rad; x <= rad + 1; x++)
          for (let y = -rad; y <= rad + 1; y++) {
            const d = (x - 0.5) ** 2 + (y - 0.5) ** 2;
            if (d <= rad * rad) leaf(x, y, z, d > (rad - 1) ** 2);
          }
      }
  else {
    const rz = kind === "Birch" ? R * 1.6 : R;
    const rx = kind === "Birch" ? Math.max(1, R - 1) : R;
    const cz = H - rz;
    for (let x = -rx; x <= rx; x++)
      for (let y = -rx; y <= rx; y++)
        for (let z = Math.round(cz - rz); z <= Math.round(cz + rz); z++) {
          const d = (x / rx) ** 2 + (y / rx) ** 2 + ((z - cz) / rz) ** 2;
          if (d <= 1.05) leaf(x, y, z, d > 0.55);
        }
  }
  const thick = kind === "Jungle" ? 2 : 1;
  const top = kind === "Spruce" ? H - 1 : H - R;
  for (let z = 0; z < top; z++)
    for (let x = 0; x < thick; x++)
      for (let y = 0; y < thick; y++) vox.set(`${x},${y},${z}`, c(v, "bark"));
  return vox;
}

export const TREE_STYLES = ["Branches", "Tiers", "Voxel"] as const;
const tree: Generator = {
  key: "tree",
  name: "Tree",
  blurb: "A branching tree, a tiered pine or a block-game tree.",
  file: "tree",
  defaults: {
    style: "Branches",
    bark: "Copper",
    leaves: "Lime",
    seed: 5,
    "b.trunk": 3,
    "b.girth": 0.45,
    "b.levels": 2,
    "b.forks": 3,
    "b.angle": 35,
    "b.ratio": 70,
    "b.clump": 1.8,
    "b.balls": 3,
    "t.height": 8,
    "t.width": 4,
    "t.tiers": 4,
    "t.taper": 70,
    "t.overlap": 40,
    "t.stem": 1.6,
    "t.snow": false,
    "v.kind": "Oak",
    "v.cell": 50,
    "v.height": 11,
    "v.radius": 3,
    "v.holes": 15,
  },
  controls: (v) => [
    { key: "style", label: "Style", kind: "choice", options: TREE_STYLES },
    ...(v.style === "Tiers"
      ? [
          num("t.height", "Height", 1, 40, 0.5, "m"),
          num("t.width", "Width", 0.5, 20, 0.5, "m"),
          num("t.tiers", "Tiers", 1, 10, 1),
          num("t.taper", "Taper", 0, 90, 5, "%", true),
          num("t.overlap", "Overlap", 0, 80, 5, "%", true),
          num("t.stem", "Bare trunk", 0, 10, 0.1, "m", true),
          { key: "t.snow", label: "Snow on each tier", kind: "toggle", more: true } as Control,
        ]
      : v.style === "Voxel"
        ? [
            { key: "v.kind", label: "Kind", kind: "choice", options: VOXEL_KINDS } as Control,
            num("v.height", "Height", 4, 40, 1, "blocks"),
            num("v.radius", "Canopy radius", 1, 10, 1, "blocks"),
            num("v.cell", "Block size", 10, 200, 5, "cm", true),
            num("v.holes", "Gaps in the leaves", 0, 60, 5, "%", true),
          ]
        : [
            num("b.trunk", "Trunk length", 0.5, 20, 0.5, "m"),
            num("b.levels", "Forks deep", 1, 4, 1),
            num("b.girth", "Trunk width", 0.1, 3, 0.05, "m", true),
            num("b.forks", "Branches per fork", 2, 5, 1, undefined, true),
            num("b.angle", "Branch angle", 10, 80, 1, "°", true),
            num("b.ratio", "Branch length", 40, 95, 5, "%", true),
            num("b.clump", "Leaf clump size", 0.3, 6, 0.1, "m", true),
            num("b.balls", "Balls per clump", 1, 6, 1, undefined, true),
          ]),
    colour("bark", "Trunk"),
    colour("leaves", "Leaves"),
    SHUFFLE,
  ],
  build: (v) =>
    fileOf(
      v.style === "Tiers"
        ? tiersTree(v)
        : v.style === "Voxel"
          ? voxelBoxes(voxelTree(v), n(v, "v.cell"))
          : branchesTree(v),
    ),
};

const bush: Generator = {
  key: "bush",
  name: "Bush",
  blurb: "A shrub of stems with clumps of leaves.",
  file: "bush",
  defaults: {
    stems: 7,
    length: 0.9,
    spread: 40,
    clump: 0.6,
    balls: 3,
    bark: "Copper",
    leaves: "Lime",
    seed: 8,
  },
  controls: () => [
    num("stems", "Stems", 1, 14, 1),
    num("length", "Stem length", 0.2, 4, 0.1, "m"),
    num("spread", "Spread", 0, 70, 1, "°", true),
    num("clump", "Leaf clump size", 0.2, 3, 0.05, "m", true),
    num("balls", "Balls per clump", 1, 6, 1, undefined, true),
    colour("bark", "Stems"),
    colour("leaves", "Leaves"),
    SHUFFLE,
  ],
  build: (v) => {
    const r = random(n(v, "seed"));
    const items: Array<PrefabItem> = [];
    const k = n(v, "stems");
    const b: Branching = {
      levels: 0,
      forks: 0,
      angle: 0,
      ratio: 0,
      clump: n(v, "clump") * 100,
      balls: n(v, "balls"),
      bark: c(v, "bark"),
      leaves: c(v, "leaves"),
    };
    for (let i = 0; i < k; i++) {
      const d = turn(
        [0, 0, 1],
        n(v, "spread") * DEG * (0.4 + r() * 0.6),
        (i / k) * Math.PI * 2 + r(),
      );
      grow(
        b,
        r,
        items,
        [0, 0, 0],
        d,
        n(v, "length") * 100 * (0.7 + r() * 0.5),
        Math.max(4, b.clump * 0.12),
        0,
      );
    }
    return fileOf(items);
  },
};

export const GENERATORS: ReadonlyArray<Generator> = [qr, sign, tree, bush];
export const generatorOf = (key: string) => GENERATORS.find((g) => g.key === key) ?? null;

/* the Prefab file `key` makes from these values, or null when there is nothing to make (no
   text); a sign in a drawn font takes the lettering that draws it, else the Pixel font's */
export function generate(key: string, values: Values, lettering: Lettering = PIXEL_LETTERING) {
  return generatorOf(key)?.build(values, lettering) ?? null;
}
