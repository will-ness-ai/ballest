// The Sign, under Useful (lib/generators/index.ts), facing the camera that spawns it; it
// letters its text in cells through a Lettering (lib/generator-letters.ts), or in one of R23's
// piece fonts with their own pieces (lib/generators/piece-fonts.ts).
import { wrapAt, type Lettering, type Measure } from "../generator-letters";
import type { PrefabItem } from "../prefab";
import { isPieceFont, pieceLettering } from "./piece-fonts";
import {
  FRONT,
  cellsOf,
  colour,
  colourIn,
  edgeOf,
  facing,
  fileOf,
  metresIn,
  num,
  piece,
  type Colour,
  type Generator,
  type V3,
} from "./pieces";

/* ---------- sign ---------- */
/* the wrap of the text that makes its letters biggest inside w by h, and how many cm to a unit
   of the font's */
function wrapToFit(text: string, measure: Measure, w: number, h: number) {
  const t = text.trim();
  if (!t) return null;
  const longest = Math.max(...t.split(/\s+/).map((x) => x.length));
  let best: { lines: Array<string>; scale: number } | null = null;
  for (let per = longest; per <= Math.max(longest, t.length); per++) {
    const lines = wrapAt(t, per, measure.letterCase);
    const wide = Math.max(...lines.map((l) => measure.width(l)));
    const scale = Math.min(w / wide, h / (lines.length * measure.lineHeight));
    if (!best || scale > best.scale) best = { lines, scale };
  }
  return best;
}

/* the wrap of the text that makes its letters biggest inside w by h, and its grid's cell */
export function fitText(text: string, lettering: Lettering, w: number, h: number) {
  const best = wrapToFit(text, lettering, w, h);
  if (!best) return null;
  const grid = lettering.grid(best.lines);
  if (!grid) return null;
  return { grid, cell: Math.min(w / grid.w, h / grid.h) };
}

export const sign: Generator = {
  key: "sign",
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
    ...(v.font === "Pixel" || isPieceFont(v.font)
      ? []
      : [num("detail", "Detail", 5, 40, 1, "blocks", true)]),
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
    if (isPieceFont(v.font)) {
      const text = String(v.text);
      const letters = builtLetters(
        text,
        pieceLettering(v.font),
        W * (1 - pad),
        H * (1 - pad),
        colourIn(v, "front"),
      );
      if (!letters) return null;
      if (!v.wall) return fileOf(moved(letters, 0, 0));
      const depth = wallDepth(W, H);
      return fileOf([
        ...facing([piece("cube", [0, 0, 0], [W, depth, H], colourIn(v, "back"))]),
        ...moved(letters, -depth / 2, (H - (edgeOf(letters, 1, 1) - edgeOf(letters, 1, -1))) / 2),
      ]);
    }
    const fit = fitText(String(v.text), lettering, W * (1 - pad), H * (1 - pad));
    if (!fit) return null;
    const { grid, cell } = fit;
    const textH = grid.h * cell;
    if (!v.wall) return fileOf(facing(cellsOf(grid, cell, textH, 0, cell, colourIn(v, "front"))));
    const depth = wallDepth(W, H);
    return fileOf(
      facing([
        piece("cube", [0, 0, 0], [W, depth, H], colourIn(v, "back")),
        ...cellsOf(grid, cell, H - (H - textH) / 2, depth / 2, cell / 2, colourIn(v, "front")),
      ]),
    );
  },
};

const wallDepth = (W: number, H: number) => Math.max(5, Math.min(W, H) * 0.03);

/* the text in a piece font, as big as fits inside w by h */
function builtLetters(
  text: string,
  font: ReturnType<typeof pieceLettering>,
  w: number,
  h: number,
  c: Colour,
) {
  const best = wrapToFit(text, font, w, h);
  return best ? font.pieces(best.lines, best.scale, c) : null;
}

/* the letters centred across x = 0, their back at `face` and their foot at `foot` */
function moved(letters: Array<PrefabItem>, face: number, foot: number): Array<PrefabItem> {
  const by: V3 = [
    face - edgeOf(letters, 0, 1),
    -(edgeOf(letters, 2, -1) + edgeOf(letters, 2, 1)) / 2,
    foot - edgeOf(letters, 1, -1),
  ];
  return letters.map((it) => {
    const [x, y, z] = it.transform.location;
    return { ...it, transform: { ...it.transform, location: [x + by[0], y + by[1], z + by[2]] } };
  });
}
