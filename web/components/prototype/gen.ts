/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: the Prefab generators for grill-design (claude/prototype-prefab-generators).
// Each one writes a BallestPrefab file from a few settings: a QR code, a sign (text, with or
// without a wall behind it), a tree, a bush. Pieces are the editor's primitives, each placed
// by its bottom centre: BP_Prim_Cube (1000 cm), BP_Prim_Sphere (400 cm), BP_Prim_Cylinder
// (1000 cm across, 200 tall), MP_Cone (300 across, 200 tall). Signs read from +Y, so x runs
// left to right for someone standing there. The paint index is a guess.
import qrcode from "qrcode-generator";

import type { PrefabFile, PrefabItem } from "../../lib/prefab";

export type Grid = { w: number; h: number; on: (x: number, y: number) => boolean };

export const COLOURS = [
  ["White", "Instances_2/MI_Env_White_Smooth"],
  ["Dark", "Instances_2/MI_Env_Dark_Smooth"],
  ["Lime", "Instances_2/MI_Env_Lime_Smooth"],
  ["Red", "Instances_2/MI_Env_Red_Smooth"],
  ["Wine", "Instances/MI_Env_Rough_Wine"],
  ["Orange", "Instances_2/MI_Env_Orange_Smooth"],
  ["Yellow", "Instances_2/MI_Env_Yellow_Smooth"],
  ["Sky blue", "Instances_2/MI_Env_SkyBlue_Smooth"],
  ["Purple", "Instances_2/MI_Env_Purple_Smooth"],
] as const;
export type Colour = (typeof COLOURS)[number][0];
export const SWATCH: Record<Colour, string> = {
  White: "#e8ecf2",
  Dark: "#3a3f4b",
  Lime: "#9be22d",
  Red: "#d8433a",
  Wine: "#7a2a3a",
  Orange: "#ef8a2f",
  Yellow: "#f2cc3a",
  "Sky blue": "#3f7fe0",
  Purple: "#9a5ae0",
};

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
const SMOOTH =
  "/Game/Art/DataAssets/BallestMaterials/MaterialCategory_Smooth.MaterialCategory_Smooth";
const material = (c: Colour) => {
  const mi = COLOURS.find((x) => x[0] === c)![1];
  const name = mi.split("/")[1];
  return `/Game/Art/Materials/Environment/Materials/${mi}.${name}`;
};

/* a piece of the given size in cm, its bottom centre at (x, y, z), turned yaw degrees */
function piece(
  kind: Kind,
  [x, y, z]: [number, number, number],
  [sx, sy, sz]: [number, number, number],
  c: Colour,
  yaw = 0,
): PrefabItem {
  const k = KINDS[kind];
  return {
    class: k.cls,
    transform: {
      location: [x, y, z],
      rotation: [0, yaw, 0],
      scale: [sx / k.size[0], sy / k.size[1], sz / k.size[2]],
    },
    properties: {},
    meshes: [{ tag: "SKGMapEditor", mesh: k.mesh, materials: [material(c)] }],
    paint: { categories: [SMOOTH], colors: [0] },
  } as unknown as PrefabItem;
}

const fileOf = (items: Array<PrefabItem>): PrefabFile => ({
  format: "BallestPrefab",
  version: 1,
  group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
  items,
});

/* the "on" cells as rectangles: each row's runs, then runs stacked where the rows agree */
export function rects(g: Grid): Array<{ x: number; y: number; w: number; h: number }> {
  const done = new Set<number>();
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (!g.on(x, y) || done.has(y * g.w + x)) continue;
      let w = 1;
      while (x + w < g.w && g.on(x + w, y) && !done.has(y * g.w + x + w)) w++;
      let h = 1;
      grow: while (y + h < g.h) {
        for (let i = 0; i < w; i++)
          if (!g.on(x + i, y + h) || done.has((y + h) * g.w + x + i)) break grow;
        h++;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) done.add((y + j) * g.w + x + i);
      out.push({ x, y, w, h });
    }
  return out;
}

/* the grid's "on" cells as boxes `cell` cm across, the grid centred on x = 0 with its top row
   at `top`, `depth` thick, starting at y = `y0` */
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

/* ---------- QR code ---------- */
export interface QrSettings {
  text: string;
  size: number;
  back: Colour;
  front: Colour;
}
export function qrGrid(text: string, margin = 2): Grid | null {
  if (!text) return null;
  try {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    return {
      w: n + margin * 2,
      h: n + margin * 2,
      on: (x, y) => {
        const i = x - margin;
        const j = y - margin;
        return i >= 0 && j >= 0 && i < n && j < n && q.isDark(j, i);
      },
    };
  } catch {
    return null;
  }
}
export function qrFile(s: QrSettings): { file: PrefabFile; grid: Grid } | null {
  const g = qrGrid(s.text);
  if (!g) return null;
  const cell = (s.size * 100) / g.w;
  const W = g.w * cell;
  const items = [piece("cube", [0, 0, 0], [W, cell / 2, W], s.back)];
  items.push(...cellsOf(g, cell, W, cell / 4, cell / 2, s.front));
  return { file: fileOf(items), grid: g };
}

/* ---------- sign: text, sized to fit ---------- */
/* a 5x7 pixel font */
const F: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  ",": "00000 00000 00000 00000 01100 00100 01000",
  "!": "00100 00100 00100 00100 00100 00000 00100",
  "?": "01110 10001 00001 00010 00100 00000 00100",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  "'": "00100 00100 01000 00000 00000 00000 00000",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  "&": "01100 10010 10100 01000 10101 10010 01101",
  "+": "00000 00100 00100 11111 00100 00100 00000",
  "#": "01010 01010 11111 01010 11111 01010 01010",
  "<": "00010 00100 01000 10000 01000 00100 00010",
  ">": "01000 00100 00010 00001 00010 00100 01000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/* the text wrapped at `per` letters a line */
function wrapAt(text: string, per: number): Array<string> {
  const lines: Array<string> = [];
  for (const para of text.toUpperCase().split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      for (let w = word; w;) {
        const room = line ? per - line.length - 1 : per;
        if (w.length <= room) {
          line = line ? line + " " + w : w;
          w = "";
        } else if (!line) {
          lines.push(w.slice(0, per));
          w = w.slice(per);
        } else {
          lines.push(line);
          line = "";
        }
      }
    }
    if (line || !lines.length) lines.push(line);
  }
  return lines;
}

function gridOf(lines: Array<string>): Grid {
  const cols = Math.max(1, ...lines.map((l) => l.length)) * (GLYPH_W + 1) - 1;
  const rows = lines.length * (GLYPH_H + 1) - 1;
  const cells = new Set<number>();
  lines.forEach((line, li) => {
    const left = Math.floor((cols - (line.length * (GLYPH_W + 1) - 1)) / 2);
    [...line].forEach((ch, ci) => {
      const rowsOf = (F[ch] ?? F["?"]).split(" ");
      for (let y = 0; y < GLYPH_H; y++)
        for (let x = 0; x < GLYPH_W; x++)
          if (rowsOf[y][x] === "1")
            cells.add((li * (GLYPH_H + 1) + y) * cols + left + ci * (GLYPH_W + 1) + x);
    });
  });
  return { w: cols, h: rows, on: (x, y) => cells.has(y * cols + x) };
}

/* the line breaks that make the letters biggest inside w by h (cm, less a margin) */
export function fitText(text: string, w: number, h: number) {
  const t = text.trim();
  const longest = Math.max(1, ...t.split(/\s+/).map((x) => x.length));
  let best: { grid: Grid; cell: number } | null = null;
  for (let per = longest; per <= Math.max(longest, t.length); per++) {
    const lines = wrapAt(t, per);
    const grid = gridOf(lines);
    const cell = Math.min(w / grid.w, h / grid.h);
    if (!best || cell > best.cell) best = { grid, cell };
  }
  return best!;
}

export interface SignSettings {
  text: string;
  width: number;
  height: number;
  wall: boolean;
  back: Colour;
  front: Colour;
}
export function signFile(s: SignSettings): { file: PrefabFile; grid: Grid; cell: number } | null {
  if (!s.text.trim()) return null;
  const W = s.width * 100;
  const H = s.height * 100;
  const pad = s.wall ? 0.12 : 0;
  const { grid, cell } = fitText(s.text, W * (1 - pad), H * (1 - pad));
  const textH = grid.h * cell;
  if (!s.wall) return { file: fileOf(cellsOf(grid, cell, textH, 0, cell, s.front)), grid, cell };
  const depth = Math.max(5, Math.min(W, H) * 0.03);
  const items = [piece("cube", [0, 0, 0], [W, depth, H], s.back)];
  items.push(...cellsOf(grid, cell, H - (H - textH) / 2, depth / 2, cell / 2, s.front));
  return { file: fileOf(items), grid, cell };
}

/* ---------- nature ---------- */
/* a small seeded random, so Shuffle gives a new shape and the same seed the same one */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TreeStyle = "Round" | "Pine" | "Blocky";
export interface TreeSettings {
  style: TreeStyle;
  height: number;
  spread: number;
  trunk: Colour;
  leaves: Colour;
  seed: number;
}
export function treeFile(s: TreeSettings): PrefabFile {
  const r = rand(s.seed);
  const H = s.height * 100;
  const S = s.spread * 100;
  const items: Array<PrefabItem> = [];
  if (s.style === "Pine") {
    const trunkH = H * 0.25;
    items.push(piece("cylinder", [0, 0, 0], [S * 0.12, S * 0.12, trunkH], s.trunk));
    const tiers = 3 + Math.floor(r() * 2);
    const tierH = (H - trunkH) / (tiers * 0.7);
    for (let i = 0; i < tiers; i++) {
      const w = S * (1 - i / (tiers + 0.5));
      items.push(
        piece("cone", [0, 0, trunkH * 0.8 + i * tierH * 0.65], [w, w, tierH], s.leaves, r() * 360),
      );
    }
  } else if (s.style === "Blocky") {
    const trunkH = H * 0.45;
    const t = S * 0.18;
    items.push(piece("cube", [0, 0, 0], [t, t, trunkH], s.trunk));
    const layers = 3;
    const lh = (H - trunkH * 0.85) / layers;
    for (let i = 0; i < layers; i++) {
      const w = S * (i === layers - 1 ? 0.5 : 1 - i * 0.15);
      const jx = (r() - 0.5) * S * 0.08;
      const jy = (r() - 0.5) * S * 0.08;
      items.push(piece("cube", [jx, jy, trunkH * 0.85 + i * lh], [w, w, lh], s.leaves));
    }
  } else {
    const trunkH = H * 0.45;
    items.push(piece("cylinder", [0, 0, 0], [S * 0.13, S * 0.13, trunkH + S * 0.2], s.trunk));
    const n = 4 + Math.floor(r() * 3);
    const crown = H - trunkH;
    items.push(piece("sphere", [0, 0, trunkH], [S * 0.75, S * 0.75, crown * 0.85], s.leaves));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const d = S * (0.18 + r() * 0.12);
      const sz = S * (0.4 + r() * 0.2);
      items.push(
        piece(
          "sphere",
          [Math.cos(a) * d, Math.sin(a) * d, trunkH + crown * (0.05 + r() * 0.35)],
          [sz, sz, sz * 0.9],
          s.leaves,
        ),
      );
    }
  }
  return fileOf(items);
}

export interface BushSettings {
  width: number;
  height: number;
  clumps: number;
  colour: Colour;
  seed: number;
}
export function bushFile(s: BushSettings): PrefabFile {
  const r = rand(s.seed);
  const W = s.width * 100;
  const H = s.height * 100;
  const items: Array<PrefabItem> = [];
  for (let i = 0; i < s.clumps; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : (W / 2) * (0.25 + r() * 0.45);
    const sz = Math.min(W, H * 1.6) * (i === 0 ? 0.7 : 0.35 + r() * 0.3);
    const h = Math.min(H, sz * (0.8 + r() * 0.3));
    items.push(
      piece("sphere", [Math.cos(a) * d, Math.sin(a) * d * 0.7, 0], [sz, sz * 0.9, h], s.colour),
    );
  }
  return fileOf(items);
}

export const PIECE_LIMIT = 4096;
