// The Generators (CONTEXT.md; spec #299): QR code, Sign, Tree and Bush, each making a Prefab
// file from a few settings. A Generator is its controls, its defaults and its builder; the
// page draws whatever controls() returns, so a new Generator is one entry in GENERATORS.
// Settled on the never-merged branch claude/prototype-prefab-generators.
//
// Pieces are the editor's primitives, placed by their bottom centre (lib/prefab-meshes.ts has
// their bounds): a cube 1000 cm, a sphere 400 cm, a cylinder 1000 cm across and 200 tall, a
// cone 300 across and 200 tall. Rotations are Unreal's [pitch, yaw, roll] in degrees. A sign
// or a QR code faces -X and reads left to right along +Y: spawnprefab puts a Prefab in front
// of the editor's camera, which looks along +X with +Y on its right, so it faces whoever
// spawned it (checked in the game).
import qrcode from "qrcode-generator";

import type { PrefabFile, PrefabItem } from "./prefab";
import type { PrefabAngle } from "./prefabs";
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
  pyramid: {
    cls: "/Game/LevelEditor/PackageAssets/BallestAssets/MapPieces/MP_Pyramid.MP_Pyramid_C",
    mesh: "/Game/LevelEditor/PackageAssets/BallestAssets/MapPieces/Meshes/SM_Pyramid.SM_Pyramid",
    size: [500, 500, 200],
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

/* a sign or code seen from in front (-X), a little from above and to the right, as it reads */
const FRONT: PrefabAngle = { from: [-0.83, 0.35, 0.43], zoom: 1, pan: [0, 0, 0] };

const fileOf = (items: Array<PrefabItem>): PrefabFile => ({
  format: "BallestPrefab",
  version: 1,
  group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
  items,
});

/* a sign or code laid out across x and standing out toward +y, turned to face -X */
const facing = (items: Array<PrefabItem>) =>
  items.map((it) => {
    const [x, y, z] = it.transform.location;
    const [sx, sy, sz] = it.transform.scale;
    return {
      ...it,
      transform: { ...it.transform, location: [-y, x, z] as V3, scale: [sy, sx, sz] as V3 },
    };
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

const numberIn = (v: Values, k: string) => Number(v[k]);
/* a control in metres, in the centimetres pieces are placed in */
const metresIn = (v: Values, k: string) => numberIn(v, k) * 100;
const colourIn = (v: Values, k: string): Colour => (isColour(v[k]) ? v[k] : "White");

export interface Generator {
  key: string;
  name: string;
  blurb: string;
  category: (typeof CATEGORIES)[number];
  /* the stem of the file Download saves, and so of the spawn command */
  file: string;
  /* it letters text, so its page loads the drawn fonts and hands build a Lettering */
  lettered?: boolean;
  /* the view its model and card start from; without one, the Prefabs' default */
  angle?: PrefabAngle;
  defaults: Values;
  /* the controls to show for these values (a switch can hide another's) */
  controls: (v: Values) => Array<Control>;
  build: (v: Values, lettering: Lettering) => PrefabFile | null;
}

/* ---------- QR code ---------- */
const qr: Generator = {
  key: "qr",
  name: "QR code",
  category: "Signs",
  blurb: "A code players can scan, built from blocks.",
  file: "qr_code",
  angle: FRONT,
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
    const size = metresIn(v, "size");
    const cell = size / grid.w;
    return fileOf(
      facing([
        piece("cube", [0, 0, 0], [size, cell / 2, size], colourIn(v, "back")),
        ...cellsOf(grid, cell, size, cell / 4, cell / 4, colourIn(v, "front")),
      ]),
    );
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
  category: "Signs",
  blurb: "Your words in blocks, on a wall or standing alone.",
  file: "sign",
  lettered: true,
  angle: FRONT,
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
    const W = metresIn(v, "width");
    const H = metresIn(v, "height");
    const pad = v.wall ? 0.12 : 0;
    const fit = fitText(String(v.text), lettering, W * (1 - pad), H * (1 - pad));
    if (!fit) return null;
    const { grid, cell } = fit;
    const textH = grid.h * cell;
    if (!v.wall) return fileOf(facing(cellsOf(grid, cell, textH, 0, cell, colourIn(v, "front"))));
    const depth = Math.max(5, Math.min(W, H) * 0.03);
    return fileOf(
      facing([
        piece("cube", [0, 0, 0], [W, depth, H], colourIn(v, "back")),
        ...cellsOf(grid, cell, H - (H - textH) / 2, depth / 2, cell / 2, colourIn(v, "front")),
      ]),
    );
  },
};

/* ---------- tree and bush ---------- */
/* a clump of `balls` leaf balls `clump` cm across, at the end of every stick */
interface Tips {
  clump: number;
  balls: number;
  leaves: Colour;
}
/* a stick forking `levels` times into `branches` branches `angle` degrees out, each `ratio`%
   as long */
interface Forks {
  levels: number;
  branches: number;
  angle: number;
  ratio: number;
}
interface Branching {
  bark: Colour;
  tips: Tips;
  /* none: the stick ends in its clump */
  forks?: Forks;
}
/* a stick from `at` along `dir`, and whatever grows from its end */
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
  const f = b.forks;
  if (!f || level >= f.levels) {
    const { clump, balls, leaves } = b.tips;
    for (let i = 0; i < balls; i++)
      items.push(
        ball(add(end, mul(inBall(r), clump * 0.45)), clump * (0.6 + r() * 0.5), leaves, 0.8),
      );
    return;
  }
  const spin = r() * Math.PI * 2;
  for (let i = 0; i < f.branches; i++) {
    const d = turn(dir, f.angle * DEG * (0.8 + r() * 0.4), spin + (i / f.branches) * Math.PI * 2);
    grow(
      b,
      r,
      items,
      end,
      norm(add(d, [0, 0, 0.35])),
      (len * f.ratio) / 100,
      width * 0.62,
      level + 1,
    );
  }
}

const branchesTree = (v: Values) => {
  const items: Array<PrefabItem> = [];
  grow(
    {
      bark: colourIn(v, "bark"),
      tips: {
        clump: metresIn(v, "b.clump"),
        balls: numberIn(v, "b.balls"),
        leaves: colourIn(v, "leaves"),
      },
      forks: {
        levels: numberIn(v, "b.levels"),
        branches: numberIn(v, "b.forks"),
        angle: numberIn(v, "b.angle"),
        ratio: numberIn(v, "b.ratio"),
      },
    },
    random(numberIn(v, "seed")),
    items,
    [0, 0, 0],
    [0, 0, 1],
    metresIn(v, "b.trunk"),
    metresIn(v, "b.girth"),
    0,
  );
  return items;
};

const tiersTree = (v: Values) => {
  const r = random(numberIn(v, "seed"));
  const H = metresIn(v, "t.height");
  const W = metresIn(v, "t.width");
  const stem = Math.min(metresIn(v, "t.stem"), H * 0.8);
  const k = numberIn(v, "t.tiers");
  const ov = numberIn(v, "t.overlap") / 100;
  const th = (H - stem) / (k - (k - 1) * ov);
  const items = [stick([0, 0, 0], [0, 0, stem + th * 0.5], W * 0.08, colourIn(v, "bark"))];
  for (let i = 0; i < k; i++) {
    const w =
      W * (1 - ((numberIn(v, "t.taper") / 100) * i) / Math.max(1, k - 1)) * (0.9 + r() * 0.2);
    const z = stem + i * th * (1 - ov);
    items.push(
      piece("cone", [0, 0, z], [w, w, th * (0.92 + r() * 0.16)], colourIn(v, "leaves"), r() * 360),
    );
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
  const r = random(numberIn(v, "seed"));
  const H = numberIn(v, "v.height");
  const R = numberIn(v, "v.radius");
  const kind = String(v["v.kind"]);
  const vox = new Map<string, Colour>();
  const leaf = (x: number, y: number, z: number, edge: boolean) => {
    if (edge && r() * 100 < numberIn(v, "v.holes")) return;
    vox.set(`${x},${y},${z}`, colourIn(v, "leaves"));
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
      for (let y = 0; y < thick; y++) vox.set(`${x},${y},${z}`, colourIn(v, "bark"));
  return vox;
}

export const TREE_STYLES = ["Branches", "Tiers", "Voxel"] as const;
type TreeStyle = (typeof TREE_STYLES)[number];
/* each tree style's own controls (their keys prefixed, so each keeps its values when another
   is picked) and the pieces it builds */
const STYLES: Record<
  TreeStyle,
  { controls: Array<Control>; build: (v: Values) => Array<PrefabItem> }
> = {
  Branches: {
    controls: [
      num("b.trunk", "Trunk length", 0.5, 20, 0.5, "m"),
      num("b.levels", "Forks deep", 1, 4, 1),
      num("b.girth", "Trunk width", 0.1, 3, 0.05, "m", true),
      num("b.forks", "Branches per fork", 2, 5, 1, undefined, true),
      num("b.angle", "Branch angle", 10, 80, 1, "°", true),
      num("b.ratio", "Branch length", 40, 95, 5, "%", true),
      num("b.clump", "Leaf clump size", 0.3, 6, 0.1, "m", true),
      num("b.balls", "Balls per clump", 1, 6, 1, undefined, true),
    ],
    build: branchesTree,
  },
  Tiers: {
    controls: [
      num("t.height", "Height", 1, 40, 0.5, "m"),
      num("t.width", "Width", 0.5, 20, 0.5, "m"),
      num("t.tiers", "Tiers", 1, 10, 1),
      num("t.taper", "Taper", 0, 90, 5, "%", true),
      num("t.overlap", "Overlap", 0, 80, 5, "%", true),
      num("t.stem", "Bare trunk", 0, 10, 0.1, "m", true),
      { key: "t.snow", label: "Snow on each tier", kind: "toggle", more: true },
    ],
    build: tiersTree,
  },
  Voxel: {
    controls: [
      { key: "v.kind", label: "Kind", kind: "choice", options: VOXEL_KINDS },
      num("v.height", "Height", 4, 40, 1, "blocks"),
      num("v.radius", "Canopy radius", 1, 10, 1, "blocks"),
      num("v.cell", "Block size", 10, 200, 5, "cm", true),
      num("v.holes", "Gaps in the leaves", 0, 60, 5, "%", true),
    ],
    build: (v) => voxelBoxes(voxelTree(v), numberIn(v, "v.cell")),
  },
};
/* PROTOTYPE (claude/prototype-make-your-own): each tree style is its own Generator, and three
   buildings. Never merged as is: /implement-spec rebuilds the winner. */
const treeOf = (
  key: string,
  name: string,
  blurb: string,
  style: TreeStyle,
  defaults: Values,
): Generator => ({
  key,
  name,
  blurb,
  category: "Nature",
  file: key.replace(/-/g, "_"),
  defaults: { style, bark: "Copper", leaves: "Lime", seed: 5, ...defaults },
  controls: () => [
    ...STYLES[style].controls,
    colour("bark", "Trunk"),
    colour("leaves", "Leaves"),
    SHUFFLE,
  ],
  build: (v) => fileOf(STYLES[style].build(v)),
});
const tree = treeOf(
  "tree",
  "Tree",
  "A trunk that forks into branches, leaves at every tip.",
  "Branches",
  {
    "b.trunk": 3,
    "b.girth": 0.45,
    "b.levels": 2,
    "b.forks": 3,
    "b.angle": 35,
    "b.ratio": 70,
    "b.clump": 1.8,
    "b.balls": 3,
  },
);
const pine = treeOf(
  "pine",
  "Pine",
  "Stacked cones over a bare trunk, with snow if you like.",
  "Tiers",
  {
    "t.height": 8,
    "t.width": 4,
    "t.tiers": 4,
    "t.taper": 70,
    "t.overlap": 40,
    "t.stem": 1.6,
    "t.snow": false,
  },
);
const blockTree = treeOf(
  "block-tree",
  "Block tree",
  "An oak, birch, spruce or jungle tree out of blocks.",
  "Voxel",
  { "v.kind": "Oak", "v.cell": 50, "v.height": 11, "v.radius": 3, "v.holes": 15 },
);

const bush: Generator = {
  key: "bush",
  name: "Bush",
  blurb: "A shrub of stems with clumps of leaves.",
  category: "Nature",
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
    const r = random(numberIn(v, "seed"));
    const items: Array<PrefabItem> = [];
    const k = numberIn(v, "stems");
    const b: Branching = {
      bark: colourIn(v, "bark"),
      tips: {
        clump: metresIn(v, "clump"),
        balls: numberIn(v, "balls"),
        leaves: colourIn(v, "leaves"),
      },
    };
    for (let i = 0; i < k; i++) {
      const d = turn(
        [0, 0, 1],
        numberIn(v, "spread") * DEG * (0.4 + r() * 0.6),
        (i / k) * Math.PI * 2 + r(),
      );
      grow(
        b,
        r,
        items,
        [0, 0, 0],
        d,
        metresIn(v, "length") * (0.7 + r() * 0.5),
        Math.max(4, b.tips.clump * 0.12),
        0,
      );
    }
    return fileOf(items);
  },
};

/* ---------- buildings ---------- */
/* A building's front faces -X, like a sign, so it faces the camera that spawns it; its width
   runs along Y and its depth along X, its ground floor on z = 0. */

/* a box `size` cm across centred at `at`, turned by `rot` */
const boxAt = (at: V3, size: V3, c: Colour, rot: V3 = [0, 0, 0]) => {
  const P = rot[0] * DEG;
  const Y = rot[1] * DEG;
  const R = rot[2] * DEG;
  /* where the box's up axis points: pitch about Y, roll about X, then yaw about Z */
  const up: V3 = [
    -Math.sin(P) * Math.cos(R) * Math.cos(Y) + Math.sin(R) * Math.sin(Y),
    -Math.sin(P) * Math.cos(R) * Math.sin(Y) - Math.sin(R) * Math.cos(Y),
    Math.cos(P) * Math.cos(R),
  ];
  return piece("cube", add(at, mul(up, -size[2] / 2)), size, c, rot);
};

/* a pyramid roof `side` cm square and `rise` tall: SM_Pyramid's corners sit at the middle of its
   bounds' edges, so it is turned 45° and grown by √2 to cover the square */
const pyramid = (at: V3, side: number, rise: number, c: Colour) =>
  piece("pyramid", at, [side * Math.SQRT2, side * Math.SQRT2, rise], c, 45);

/* the two slabs of a pitched roof over a building `span` cm across, its ridge `length` long
   along Y (or along X), sloping at `pitch`° from the wall top at `top` out past an eave */
function slopes(
  span: number,
  length: number,
  alongY: boolean,
  eave: number,
  pitch: number,
  top: number,
  c: Colour,
) {
  const half = span / 2 + eave;
  const tan = Math.tan(pitch * DEG);
  const z = top + (tan * (span / 2)) / 2 - (tan * eave) / 2 + 8;
  return [-1, 1].map((s) =>
    alongY
      ? boxAt([(s * half) / 2, 0, z], [half / Math.cos(pitch * DEG), length, 15], c, [
          -s * pitch,
          0,
          0,
        ])
      : boxAt([0, (s * half) / 2, z], [length, half / Math.cos(pitch * DEG), 15], c, [
          0,
          0,
          -s * pitch,
        ]),
  );
}

interface Opening {
  /* along the wall from its left end, its middle, and its width, bottom and top, in cm */
  at: number;
  width: number;
  bottom: number;
  top: number;
}
/* a wall `length` long and `height` tall with holes, as the boxes around them: a pier between
   each pair of holes, and a piece under and over each one. `place` turns a box given in the
   wall's own frame (u along it, from its left end; z up) into the world */
function wall(
  length: number,
  height: number,
  holes: Array<Opening>,
  place: (u0: number, u1: number, z0: number, z1: number) => PrefabItem,
) {
  const items: Array<PrefabItem> = [];
  const sorted = [...holes].sort((a, b) => a.at - b.at);
  let u = 0;
  for (const h of sorted) {
    const l = h.at - h.width / 2;
    const r = h.at + h.width / 2;
    if (l > u + 1) items.push(place(u, l, 0, height));
    if (h.bottom > 1) items.push(place(l, r, 0, h.bottom));
    if (h.top < height - 1) items.push(place(l, r, h.top, height));
    u = r;
  }
  if (length > u + 1) items.push(place(u, length, 0, height));
  return items;
}

/* `n` windows `w` wide spread evenly along a wall `length` long, from sill to head */
const windowsAlong = (length: number, n: number, w: number, sill: number, head: number) =>
  Array.from({ length: n }, (_, i) => ({
    at: ((i + 1) * length) / (n + 1),
    width: w,
    bottom: sill,
    top: head,
  }));

const ROOFS = ["Gable", "Hip", "Flat"] as const;
const house: Generator = {
  key: "house",
  name: "House",
  blurb: "Walls with windows and a door, one floor or several, under a roof.",
  category: "Buildings",
  file: "house",
  angle: { from: [-0.75, 0.45, 0.5], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    width: 9,
    depth: 7,
    floors: 2,
    storey: 3,
    roof: "Gable",
    pitch: 35,
    windows: 3,
    door: true,
    chimney: true,
    walls: "White",
    roofc: "Wine",
    trim: "Dark",
    glass: "Sky blue",
  },
  controls: (v) => [
    num("width", "Width", 4, 30, 0.5, "m"),
    num("depth", "Depth", 4, 30, 0.5, "m"),
    num("floors", "Floors", 1, 5, 1),
    { key: "roof", label: "Roof", kind: "choice", options: ROOFS },
    ...(v.roof === "Flat" ? [] : [num("pitch", "Roof slope", 15, 55, 1, "°", true)]),
    num("windows", "Windows a side", 0, 8, 1),
    { key: "door", label: "Front door", kind: "toggle" },
    { key: "chimney", label: "Chimney", kind: "toggle", more: true },
    num("storey", "Floor height", 2.5, 5, 0.1, "m", true),
    colour("walls", "Walls"),
    colour("roofc", "Roof"),
    colour("trim", "Door and trim"),
    colour("glass", "Windows"),
  ],
  build: (v) => {
    const W = metresIn(v, "width");
    const D = metresIn(v, "depth");
    const h = metresIn(v, "storey");
    const floors = numberIn(v, "floors");
    const t = 20;
    const walls = colourIn(v, "walls");
    const items: Array<PrefabItem> = [boxAt([0, 0, 10], [D, W, 20], colourIn(v, "trim"))];
    const n = numberIn(v, "windows");
    for (let f = 0; f < floors; f++) {
      const z = 20 + f * h;
      const holesFront = windowsAlong(W, n, 100, 90, 200);
      const holesSide = windowsAlong(D - 2 * t, Math.max(0, Math.round((n * D) / W)), 100, 90, 200);
      if (f === 0 && v.door) {
        /* the door takes the middle window's place */
        const mid = holesFront.findIndex((o) => Math.abs(o.at - W / 2) < W / (2 * (n + 1)));
        if (mid >= 0) holesFront.splice(mid, 1);
        holesFront.push({ at: W / 2, width: 110, bottom: 0, top: 220 });
        items.push(boxAt([-D / 2 + t / 2, 0, z + 110], [t / 2, 100, 210], colourIn(v, "trim")));
      }
      for (const [x, holes] of [
        [-D / 2 + t / 2, holesFront],
        [D / 2 - t / 2, windowsAlong(W, n, 100, 90, 200)],
      ] as const) {
        items.push(
          ...wall(W, h, holes, (u0, u1, z0, z1) =>
            boxAt([x, -W / 2 + (u0 + u1) / 2, z + (z0 + z1) / 2], [t, u1 - u0, z1 - z0], walls),
          ),
        );
        for (const o of holes)
          if (o.bottom > 0)
            items.push(
              boxAt(
                [x + (x < 0 ? -12 : 12), -W / 2 + o.at, z + o.bottom - 5],
                [24, o.width + 20, 10],
                colourIn(v, "trim"),
              ),
            );
        for (const o of holes)
          if (o.bottom > 0)
            items.push(
              boxAt(
                [x, -W / 2 + o.at, z + (o.bottom + o.top) / 2],
                [4, o.width, o.top - o.bottom],
                colourIn(v, "glass"),
              ),
            );
      }
      for (const y of [-W / 2 + t / 2, W / 2 - t / 2]) {
        items.push(
          ...wall(D - 2 * t, h, holesSide, (u0, u1, z0, z1) =>
            boxAt([-D / 2 + t + (u0 + u1) / 2, y, z + (z0 + z1) / 2], [u1 - u0, t, z1 - z0], walls),
          ),
        );
        for (const o of holesSide)
          items.push(
            boxAt(
              [-D / 2 + t + o.at, y + (y < 0 ? -12 : 12), z + o.bottom - 5],
              [o.width + 20, 24, 10],
              colourIn(v, "trim"),
            ),
          );
        for (const o of holesSide)
          items.push(
            boxAt(
              [-D / 2 + t + o.at, y, z + (o.bottom + o.top) / 2],
              [o.width, 4, o.top - o.bottom],
              colourIn(v, "glass"),
            ),
          );
      }
      items.push(boxAt([0, 0, z + h - 10], [D, W, 20], walls));
    }
    const top = 20 + floors * h;
    const roofc = colourIn(v, "roofc");
    const eave = 40;
    const p = numberIn(v, "pitch");
    const tan = Math.tan(p * DEG);
    if (v.chimney) {
      /* through the back slope, a third of the way along, standing clear of the ridge */
      const ridgeZ = v.roof === "Flat" ? top + 80 : top + tan * (Math.min(W, D) / 2);
      const cx = D / 4;
      const cz = v.roof === "Flat" ? top : top + tan * (D / 2 - cx);
      items.push(
        boxAt(
          [cx, W / 4, (cz - 40 + ridgeZ + 60) / 2],
          [60, 60, ridgeZ + 60 - (cz - 40)],
          colourIn(v, "trim"),
        ),
      );
    }
    if (v.roof === "Flat") {
      items.push(boxAt([0, 0, top + 6], [D - 40, W - 40, 12], roofc));
      for (const [at, size] of [
        [
          [-D / 2 + 10, 0, top + 40],
          [20, W, 80],
        ],
        [
          [D / 2 - 10, 0, top + 40],
          [20, W, 80],
        ],
        [
          [0, -W / 2 + 10, top + 40],
          [D, 20, 80],
        ],
        [
          [0, W / 2 - 10, top + 40],
          [D, 20, 80],
        ],
      ] as Array<[V3, V3]>)
        items.push(boxAt(at, size, roofc));
    } else if (v.roof === "Hip") {
      /* a ridge along the longer side, ending in a pyramid at each end whose inner half sits
         under the ridge's slabs */
      const short = Math.min(W, D);
      const ridge = Math.abs(W - D);
      const alongY = W >= D;
      const base = top - tan * eave - 3;
      for (const e of ridge > 0 ? [-1, 1] : [0]) {
        const at: V3 = alongY ? [0, (e * ridge) / 2, base] : [(e * ridge) / 2, 0, base];
        items.push(pyramid(at, short + 2 * eave, tan * (short / 2 + eave), roofc));
      }
      if (ridge > 0) items.push(...slopes(short, ridge, alongY, eave, p, top, roofc));
    } else {
      /* two slabs meeting over the ridge, which runs across the front; stepped gable ends kept
         under the roof's line */
      items.push(...slopes(D, W + 2 * eave, true, eave, p, top, roofc));
      const rise = tan * (D / 2);
      const steps = Math.max(1, Math.round(rise / 20));
      const sh = rise / steps;
      for (let i = 0; i < steps; i++) {
        const sw = Math.max(0, (2 * (rise - (i + 1) * sh)) / tan);
        if (sw > 5)
          for (const y of [-W / 2 + t / 2, W / 2 - t / 2])
            items.push(boxAt([0, y, top + i * sh + sh / 2], [sw, t, sh], walls));
      }
    }
    return fileOf(items);
  },
};

const CROWNS = ["Flat", "Spire", "Antenna"] as const;
const tower: Generator = {
  key: "tower",
  name: "Tower",
  blurb: "A glass tower with a band at every floor, stepping in as it rises.",
  category: "Buildings",
  file: "tower",
  angle: { from: [-0.7, 0.35, 0.62], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    shape: "Square",
    width: 14,
    floors: 24,
    storey: 3.5,
    setbacks: 2,
    step: 18,
    columns: 6,
    crown: "Spire",
    frame: "Aluminum",
    glass: "Sky blue",
    top: "Dark",
  },
  controls: () => [
    { key: "shape", label: "Shape", kind: "choice", options: ["Square", "Round"] },
    num("width", "Width", 6, 60, 1, "m"),
    num("floors", "Floors", 3, 80, 1),
    num("setbacks", "Setbacks", 0, 4, 1),
    { key: "crown", label: "Top", kind: "choice", options: CROWNS },
    num("columns", "Columns a side", 0, 12, 1, undefined, true),
    num("step", "Step in", 5, 35, 1, "%", true),
    num("storey", "Floor height", 3, 6, 0.1, "m", true),
    colour("frame", "Frame"),
    colour("glass", "Glass"),
    colour("top", "Top"),
  ],
  build: (v) => {
    const floors = numberIn(v, "floors");
    const h = metresIn(v, "storey");
    const sections = numberIn(v, "setbacks") + 1;
    const per = Math.ceil(floors / sections);
    const frame = colourIn(v, "frame");
    const glass = colourIn(v, "glass");
    const top = colourIn(v, "top");
    const round = v.shape === "Round";
    /* a block, or a drum, `w` across and `ht` tall from z */
    const mass = (w: number, ht: number, z: number, c: Colour) =>
      round
        ? piece("cylinder", [0, 0, z], [w, w, ht], c)
        : boxAt([0, 0, z + ht / 2], [w, w, ht], c);
    const items: Array<PrefabItem> = [];
    let W = metresIn(v, "width");
    /* a lobby: the ground floor set back in the top colour, a canopy over the front door */
    items.push(mass(W - 80, h, 0, top));
    items.push(boxAt([-W / 2 - 40, 0, h * 0.75], [160, Math.min(600, W * 0.4), 20], frame));
    let z = h;
    for (let s = 0; s < sections; s++) {
      const n = Math.min(per, floors - 1 - s * per);
      if (n <= 0) break;
      items.push(mass(W - 30, n * h, z, glass));
      for (let f = 0; f <= n; f++) items.push(mass(W, 40, z + f * h - 20, frame));
      const cols = numberIn(v, "columns");
      for (let c = 0; c <= cols && cols > 0; c++) {
        if (round) {
          const a = (c / (cols + 1)) * Math.PI * 2;
          items.push(
            boxAt(
              [Math.cos(a) * (W / 2 - 15), Math.sin(a) * (W / 2 - 15), z + (n * h) / 2],
              [30, 30, n * h],
              frame,
            ),
          );
          continue;
        }
        const u = -W / 2 + (c * W) / cols;
        for (const [x, y] of [
          [-W / 2 + 15, u],
          [W / 2 - 15, u],
          [u, -W / 2 + 15],
          [u, W / 2 - 15],
        ])
          items.push(boxAt([x, y, z + (n * h) / 2], [30, 30, n * h], frame));
      }
      z += n * h;
      if (s < sections - 1) W *= 1 - numberIn(v, "step") / 100;
    }
    const tall = z;
    if (v.crown === "Spire") {
      const sw = W * 0.45;
      items.push(
        piece(
          round ? "cone" : "pyramid",
          [0, 0, z + 20],
          round
            ? [sw, sw, Math.min(sw * 3, tall * 0.25)]
            : [sw * Math.SQRT2, sw * Math.SQRT2, Math.min(sw * 3, tall * 0.25)],
          top,
          round ? 0 : 45,
        ),
      );
    } else if (v.crown === "Antenna") {
      items.push(mass(W * 0.4, 200, z, top));
      const mast = Math.max(40, W * 0.05);
      items.push(
        piece("cylinder", [0, 0, z + 200], [mast, mast, Math.min(W * 2, tall * 0.2)], frame),
      );
    } else items.push(mass(W * 0.6, 120, z, top));
    return fileOf(items);
  },
};

const castle: Generator = {
  key: "castle",
  name: "Castle",
  blurb: "Battlemented walls round a keep, a round tower at each corner and a gate.",
  category: "Buildings",
  file: "castle",
  angle: { from: [-0.75, 0.5, 0.45], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    size: 24,
    height: 6,
    towers: true,
    keep: true,
    gate: 4,
    merlons: 1,
    stone: "Aluminum",
    roofc: "Wine",
    gatec: "Copper",
  },
  controls: (v) => [
    num("size", "Size", 10, 80, 1, "m"),
    num("height", "Wall height", 3, 20, 0.5, "m"),
    { key: "towers", label: "Corner towers", kind: "toggle" },
    { key: "keep", label: "Keep in the middle", kind: "toggle" },
    num("gate", "Gate width", 0, 10, 0.5, "m", true),
    num("merlons", "Battlement spacing", 0.5, 3, 0.1, "m", true),
    colour("stone", "Stone"),
    ...(v.towers || v.keep ? [colour("roofc", "Roofs")] : []),
    colour("gatec", "Gate"),
  ],
  build: (v) => {
    const S = metresIn(v, "size");
    const H = metresIn(v, "height");
    const t = Math.max(60, S * 0.03);
    const stone = colourIn(v, "stone");
    const roofc = colourIn(v, "roofc");
    const items: Array<PrefabItem> = [];
    const gate = metresIn(v, "gate");
    const step = metresIn(v, "merlons");
    /* each side: a wall, its battlements, and for the front a gate */
    const sides: Array<[V3, number]> = [
      [[-S / 2, 0, 0], 0],
      [[S / 2, 0, 0], 0],
      [[0, -S / 2, 0], 90],
      [[0, S / 2, 0], 90],
    ];
    sides.forEach(([c, yaw], i) => {
      const along = (u: number): V3 => (yaw ? [c[0] + u, c[1], 0] : [c[0], c[1] + u, 0]);
      const size = (len: number, ht: number): V3 => (yaw ? [len, t, ht] : [t, len, ht]);
      const holes =
        i === 0 && gate > 0
          ? [{ at: S / 2, width: gate, bottom: 0, top: Math.min(H - 80, gate * 1.3) }]
          : [];
      items.push(
        ...wall(S, H, holes, (u0, u1, z0, z1) => {
          const m = along(-S / 2 + (u0 + u1) / 2);
          return boxAt([m[0], m[1], (z0 + z1) / 2], size(u1 - u0, z1 - z0), stone);
        }),
      );
      if (holes.length) {
        /* square towers either side of the gate, a little taller than the wall */
        for (const e of [-1, 1]) {
          const gt = Math.max(320, gate * 0.75);
          const gy = e * (gate / 2 + gt / 2);
          items.push(boxAt([c[0], gy, (H * 1.4) / 2], [gt * 1.2, gt, H * 1.4], stone));
          for (const [dx, dy] of [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ])
            items.push(
              boxAt(
                [c[0] + dx * gt * 0.45, gy + dy * gt * 0.38, H * 1.4 + 40],
                [gt * 0.3, gt * 0.24, 80],
                stone,
              ),
            );
        }
        const m = along(0);
        items.push(
          boxAt(
            [m[0] - t / 2 - 5, m[1], holes[0].top / 2],
            [10, gate, holes[0].top],
            colourIn(v, "gatec"),
          ),
        );
      }
      for (let u = -S / 2 + step / 2; u < S / 2; u += step * 2) {
        const m = along(u + step / 2);
        items.push(boxAt([m[0], m[1], H + 45], size(step, 90), stone));
      }
    });
    if (v.towers)
      for (const [x, y] of [
        [-S / 2, -S / 2],
        [-S / 2, S / 2],
        [S / 2, -S / 2],
        [S / 2, S / 2],
      ]) {
        const d = Math.min(700, Math.max(200, S * 0.16));
        const th = H * 1.35;
        items.push(piece("cylinder", [x, y, 0], [d, d, th], stone));
        /* a ring of battlements round the top, under the roof's eaves */
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          items.push(
            boxAt(
              [x + Math.cos(a) * d * 0.5, y + Math.sin(a) * d * 0.5, th + 35],
              [d * 0.22, d * 0.22, 70],
              stone,
              [0, a / DEG, 0],
            ),
          );
        }
        items.push(piece("cone", [x, y, th + 70], [d * 1.1, d * 1.1, d * 1.1], roofc));
      }
    if (v.keep) {
      const k = S * 0.32;
      items.push(boxAt([S * 0.1, 0, H * 0.9], [k, k, H * 1.8], stone));
      items.push(pyramid([S * 0.1, 0, H * 1.8], k * 1.05, k * 0.55, roofc));
    }
    return fileOf(items);
  },
};

export const CATEGORIES = ["Signs", "Nature", "Buildings"] as const;
export const GENERATORS: ReadonlyArray<Generator> = [
  qr,
  sign,
  tree,
  pine,
  blockTree,
  bush,
  house,
  tower,
  castle,
];
export const generatorOf = (key: string) => GENERATORS.find((g) => g.key === key) ?? null;

/* the Prefab file `key` makes from these values, or null when there is nothing to make (no
   text); a sign in a drawn font takes the lettering that draws it, else the Pixel font's */
export function generate(key: string, values: Values, lettering: Lettering = PIXEL_LETTERING) {
  return generatorOf(key)?.build(values, lettering) ?? null;
}
