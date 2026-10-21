/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: the two Prefab generators for grill-design (claude/prototype-prefab-generators).
// Each one lays out a grid of cells (on / off), merges the "on" cells into as few boxes as it
// can, and writes a BallestPrefab file: one backing plate plus the raised boxes, each a
// BP_Prim_Cube (a 1000 cm cube at scale 1, pivot at its bottom centre). The face to read from
// is +Y, so x runs left to right for someone standing there. The paint index is a guess.
import qrcode from "qrcode-generator";

import type { PrefabFile, PrefabItem } from "../../lib/prefab";

export type Grid = { w: number; h: number; on: (x: number, y: number) => boolean };

export const COLOURS = [
  ["White", "MI_Env_White_Smooth"],
  ["Dark", "MI_Env_Dark_Smooth"],
  ["Lime", "MI_Env_Lime_Smooth"],
  ["Red", "MI_Env_Red_Smooth"],
  ["Orange", "MI_Env_Orange_Smooth"],
  ["Yellow", "MI_Env_Yellow_Smooth"],
  ["Sky blue", "MI_Env_SkyBlue_Smooth"],
  ["Blue", "MI_Env_Blue_Smooth"],
  ["Purple", "MI_Env_Purple_Smooth"],
] as const;
export type Colour = (typeof COLOURS)[number][0];
export const SWATCH: Record<Colour, string> = {
  White: "#e8ecf2",
  Dark: "#3a3f4b",
  Lime: "#9be22d",
  Red: "#d8433a",
  Orange: "#ef8a2f",
  Yellow: "#f2cc3a",
  "Sky blue": "#3f7fe0",
  Blue: "#3f7fe0",
  Purple: "#9a5ae0",
};

const CUBE =
  "/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/ExampleObjects/BallestPieces/BP_Prim_Cube.BP_Prim_Cube_C";
const MESH = "/Game/Art/GreyBoxing/_GENERATED/PC/Box_C559BEB3.Box_C559BEB3";
const SMOOTH =
  "/Game/Art/DataAssets/BallestMaterials/MaterialCategory_Smooth.MaterialCategory_Smooth";
const material = (c: Colour) => {
  const mi = COLOURS.find((x) => x[0] === c)![1];
  return `/Game/Art/Materials/Environment/Materials/Instances_2/${mi}.${mi}`;
};

/* a box of the given size in cm, its centre at (x, y) and its bottom at z */
function box(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  c: Colour,
): PrefabItem {
  return {
    class: CUBE,
    transform: {
      location: [x, y, z],
      rotation: [0, 0, 0],
      scale: [sx / 1000, sy / 1000, sz / 1000],
    },
    properties: {},
    meshes: [{ tag: "SKGMapEditor", mesh: MESH, materials: [material(c)] }],
    paint: { categories: [SMOOTH], colors: [0] },
  } as PrefabItem;
}

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

/* a standing plate of the grid's size, the "on" cells raised out of its +Y face */
export function wallOf(
  g: Grid,
  cell: number,
  back: Colour,
  front: Colour,
  depth = cell / 2,
  raise = cell / 2,
): PrefabFile {
  const W = g.w * cell;
  const H = g.h * cell;
  const items = [box(0, 0, 0, W, depth, H, back)];
  for (const r of rects(g)) {
    const cx = -W / 2 + (r.x + r.w / 2) * cell;
    const top = H - r.y * cell;
    items.push(
      box(cx, depth / 2 + raise / 2, top - r.h * cell, r.w * cell, raise, r.h * cell, front),
    );
  }
  return {
    format: "BallestPrefab",
    version: 1,
    group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
    items,
  };
}

/* ---------- QR code ---------- */
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

/* ---------- wall of text: a 5x7 pixel font ---------- */
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

/* the text wrapped to fit `cols` cells across, one cell between letters and one row between lines */
export function wrap(text: string, cols: number): Array<string> {
  const per = Math.max(1, Math.floor((cols + 1) / (GLYPH_W + 1)));
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
    lines.push(line);
  }
  return lines;
}

export type TextLayout = { grid: Grid; fits: boolean; lines: number; maxLines: number };

/* the wall `cols` by `rows` cells, the text centred on it; `fits` says whether every line made it */
export function textGrid(text: string, cols: number, rows: number): TextLayout {
  const lines = wrap(text.trim(), cols - 2);
  const maxLines = Math.max(0, Math.floor((rows - 2 + 1) / (GLYPH_H + 1)));
  const shown = lines.slice(0, maxLines);
  const cells = new Set<number>();
  const blockH = shown.length * (GLYPH_H + 1) - 1;
  const top = Math.floor((rows - blockH) / 2);
  shown.forEach((line, li) => {
    const lw = line.length * (GLYPH_W + 1) - 1;
    const left = Math.floor((cols - lw) / 2);
    [...line].forEach((ch, ci) => {
      const rowsOf = (F[ch] ?? F["?"]).split(" ");
      for (let y = 0; y < GLYPH_H; y++)
        for (let x = 0; x < GLYPH_W; x++)
          if (rowsOf[y][x] === "1")
            cells.add((top + li * (GLYPH_H + 1) + y) * cols + left + ci * (GLYPH_W + 1) + x);
    });
  });
  return {
    grid: { w: cols, h: rows, on: (x, y) => cells.has(y * cols + x) },
    fits: lines.length <= maxLines,
    lines: lines.length,
    maxLines,
  };
}

export const PIECE_LIMIT = 4096;
