// Signs, under Useful (lib/generators/index.ts): a QR code and a Sign, both facing the camera
// that spawns them; a sign letters its text through a Lettering (lib/generator-letters.ts).
import qrcode from "qrcode-generator";

import { wrapAt, type Grid, type Lettering } from "../generator-letters";
import {
  FRONT,
  cellsOf,
  colour,
  colourIn,
  facing,
  fileOf,
  metresIn,
  num,
  piece,
  type Generator,
} from "./pieces";

/* ---------- QR code ---------- */
export const qr: Generator = {
  key: "qr",
  loose: true,
  name: "QR code",
  category: "Useful",
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

export const sign: Generator = {
  key: "sign",
  loose: true,
  name: "Sign",
  category: "Useful",
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
