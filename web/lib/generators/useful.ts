// Useful (lib/generators/index.ts), beside the Sign: Arrow sign, Pixel art,
// Stairs, Bridge and Floor tiles. A sign or a picture faces -X like the Sign; stairs climb away
// from the camera (+X) and a bridge spans across its view (along Y).
import { colourOf, type PrefabItem } from "../prefab";
import type { Grid } from "../generator-letters";
import {
  COLOURS,
  COLOUR_NAMES,
  FRONT,
  SHUFFLE,
  add,
  boxAt,
  choice,
  colour,
  colourIn,
  facing,
  fileOf,
  metresIn,
  norm,
  num,
  numberIn,
  piece,
  random,
  rects,
  slab,
  stick,
  type Colour,
  type Generator,
  type V3,
} from "./pieces";

/* each colour's own cells of a grid as boxes `cw` by `ch` cm, laid out across x (row 0 at the
   top, `top` cm up) and `depth` thick out toward +y from y0, as `facing` turns a sign */
function cellBoxes(
  colourAt: (x: number, y: number) => Colour | null,
  w: number,
  h: number,
  cw: number,
  ch: number,
  top: number,
  y0: number,
  depth: number,
) {
  const items: Array<PrefabItem> = [];
  for (const c of COLOUR_NAMES)
    for (const r of rects({ w, h, on: (x, y) => colourAt(x, y) === c }))
      items.push(
        piece(
          "cube",
          [(-w / 2 + r.x + r.w / 2) * cw, y0 + depth / 2, top - (r.y + r.h) * ch],
          [r.w * cw, depth, r.h * ch],
          c,
        ),
      );
  return items;
}

/* ---------- arrow sign ---------- */
const ARROWS = ["Arrow", "Turn", "U-turn", "Chevrons"] as const;
type Pt = [number, number];
/* is p inside the triangle abc */
function inTri(p: Pt, a: Pt, b: Pt, c: Pt) {
  const s = (u: Pt, v: Pt, w: Pt) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
  const d1 = s(p, a, b);
  const d2 = s(p, b, c);
  const d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
const inBox = ([x, y]: Pt, x0: number, x1: number, y0: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;
/* each shape in a unit square, x to the right and y up, pointing right (a U-turn comes back
   down on the left) */
const SHAPES: Record<(typeof ARROWS)[number], (p: Pt) => boolean> = {
  Arrow: (p) => inBox(p, 0.05, 0.58, 0.36, 0.64) || inTri(p, [0.5, 0.1], [0.97, 0.5], [0.5, 0.9]),
  Turn: (p) =>
    inBox(p, 0.18, 0.42, 0.03, 0.64) ||
    inBox(p, 0.18, 0.62, 0.4, 0.64) ||
    inTri(p, [0.58, 0.22], [0.97, 0.52], [0.58, 0.82]),
  "U-turn": (p) => {
    const r = Math.hypot(p[0] - 0.48, p[1] - 0.6);
    return (
      inBox(p, 0.6, 0.84, 0.03, 0.6) ||
      (p[1] >= 0.6 && r >= 0.12 && r <= 0.36) ||
      inBox(p, 0.12, 0.36, 0.3, 0.6) ||
      inTri(p, [0.0, 0.32], [0.48, 0.32], [0.24, 0.03])
    );
  },
  Chevrons: ([x, y]) =>
    [0.04, 0.35, 0.66].some((x0) => {
      const at = x0 + 0.5 * (0.42 - Math.abs(y - 0.5));
      return Math.abs(y - 0.5) <= 0.42 && x >= at && x <= at + 0.16;
    }),
};

export const arrowSign: Generator = {
  key: "arrow",
  name: "Arrow sign",
  category: "Useful",
  blurb: "A board with an arrow, a turn, a U-turn or chevrons, to show the way.",
  file: "arrow_sign",
  angle: FRONT,
  defaults: {
    shape: "Arrow",
    points: "Right",
    width: 4,
    height: 2,
    detail: 32,
    post: false,
    board: "Yellow",
    arrow: "Dark",
  },
  controls: (v) => [
    choice("shape", "Shape", ARROWS),
    choice(
      "points",
      "Points",
      v.shape === "Arrow" || v.shape === "Chevrons"
        ? ["Left", "Right", "Up", "Down"]
        : ["Left", "Right"],
    ),
    num("width", "Width", 0.5, 30, 0.5, "m"),
    num("height", "Height", 0.5, 30, 0.5, "m"),
    { key: "post", label: "On a post", kind: "toggle" },
    num("detail", "Detail", 12, 48, 1, "blocks", true),
    colour("board", "Board"),
    colour("arrow", "Arrow"),
  ],
  build: (v) => {
    const W = metresIn(v, "width");
    const H = metresIn(v, "height");
    const cols = numberIn(v, "detail");
    const rows = Math.max(4, Math.round((cols * H) / W));
    const cw = W / cols;
    const ch = H / rows;
    const shape = SHAPES[ARROWS.find((a) => a === v.shape) ?? "Arrow"];
    /* a Turn or U-turn can only point sideways, whatever an earlier shape left in "points" */
    const sideways = v.shape !== "Arrow" && v.shape !== "Chevrons";
    const pts = sideways && v.points !== "Left" ? "Right" : String(v.points);
    /* the drawing keeps to a box inside the board: a turn in a square, an arrow or chevrons
       stretched along the way they point to at most three times as long as they are wide */
    const along = pts === "Up" || pts === "Down" ? H / W : W / H;
    const stretch =
      v.shape === "Turn" || v.shape === "U-turn" ? 1 : Math.min(3, Math.max(1, along));
    const aspect = pts === "Up" || pts === "Down" ? 1 / stretch : stretch;
    const bw = Math.min(W, H * aspect);
    const bh = bw / aspect;
    const on = (x: number, y: number): Colour | null => {
      /* the cell's middle in the box, as 0 to 1 across and up, a cell in from the board's edge */
      const m = (1.2 * cw) / bw;
      const n = (1.2 * ch) / bh;
      const u = (((x + 0.5) * cw - (W - bw) / 2) / bw - m) / (1 - 2 * m);
      const w = (1 - ((y + 0.5) * ch - (H - bh) / 2) / bh - n) / (1 - 2 * n);
      if (u < 0 || u > 1 || w < 0 || w > 1) return null;
      const p: Pt =
        pts === "Left"
          ? [1 - u, w]
          : pts === "Up"
            ? [w, 1 - u]
            : pts === "Down"
              ? [1 - w, u]
              : [u, w];
      return shape(p) ? colourIn(v, "arrow") : null;
    };
    const depth = Math.max(5, Math.min(W, H) * 0.03);
    const lift = v.post ? Math.max(150, H * 0.6) : 0;
    const items = [
      piece("cube", [0, 0, lift], [W, depth, H], colourIn(v, "board")),
      ...cellBoxes(on, cols, rows, cw, ch, lift + H, depth / 2, Math.min(cw, ch) / 2),
    ];
    if (v.post) {
      const d = Math.max(15, W * 0.04);
      items.push(
        piece("cylinder", [0, -depth / 2 - d / 2, 0], [d, d, lift + H * 0.8], colourIn(v, "arrow")),
      );
    }
    return fileOf(facing(items));
  },
};

/* ---------- pixel art ---------- */
/* A picture is "<w>x<h>:" and a character a cell, row by row from the top: "." is empty and
   "a", "b", ... the colours in COLOUR_NAMES' order. The page turns an uploaded image into one
   (pictureOf), at most PICTURE_MOST cells the longer way. */
export const PICTURE_MOST = 128;
const PALETTE = COLOUR_NAMES.map((n) => {
  const hex = colourOf(COLOURS[n].material.split("/").at(-1) ?? "");
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
});

/* an image's pixels (RGBA, row by row) as a picture in the Generators' colours, the nearest of
   each by a weighted RGB distance; a pixel under half opaque is empty */
export function pictureOf(rgba: ArrayLike<number>, w: number, h: number): string {
  let s = `${String(w)}x${String(h)}:`;
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = [0, 1, 2, 3].map((k) => rgba[i * 4 + k]);
    if (a < 128) {
      s += ".";
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    PALETTE.forEach(([pr, pg, pb], k) => {
      const rm = (r + pr) / 2;
      const d =
        (2 + rm / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - rm) / 256) * (b - pb) ** 2;
      if (d < bestD) [best, bestD] = [k, d];
    });
    s += String.fromCharCode(97 + best);
  }
  return s;
}

/* a picture read back: its size and each cell's colour, or null for a malformed one */
export function readPicture(s: string) {
  const m = /^(\d+)x(\d+):(.*)$/.exec(s);
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (!w || !h || m[3].length !== w * h) return null;
  return {
    w,
    h,
    at: (x: number, y: number): Colour | null => {
      const k = m[3].charCodeAt(y * w + x) - 97;
      return k >= 0 && k < COLOUR_NAMES.length ? COLOUR_NAMES[k] : null;
    },
  };
}

/* the most blocks across a picture can be resampled to and stay within PICTURE_MOST the longer
   way */
function acrossMost(pic: { w: number; h: number } | null) {
  if (!pic || pic.h <= pic.w) return PICTURE_MOST;
  let w = Math.ceil(((PICTURE_MOST + 0.5) * pic.w) / pic.h);
  while (w > 1 && Math.round((w * pic.h) / pic.w) > PICTURE_MOST) w--;
  return w;
}

/* the picture it starts with: the site's lime marble, 16 cells across */
export const MARBLE = (() => {
  const n = 16;
  const ch = (c: Colour) => String.fromCharCode(97 + COLOUR_NAMES.indexOf(c));
  let s = `${String(n)}x${String(n)}:`;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const [dx, dy] = [x - 7.5, y - 7.5];
      const r = Math.hypot(dx, dy);
      const shine = Math.hypot(x - 5, y - 5);
      s +=
        r > 7.6
          ? "."
          : r > 6.4
            ? ch("Dark")
            : shine < 1.6
              ? ch("White")
              : dx + dy > 4
                ? ch("Wine")
                : ch("Lime");
    }
  return s;
})();

export const pixelArt: Generator = {
  key: "pixel-art",
  name: "Pixel art",
  category: "Useful",
  blurb: "Your picture in blocks of the editor's colours, standing up or laid on the floor.",
  file: "pixel_art",
  angle: FRONT,
  defaults: {
    picture: MARBLE,
    across: 16,
    block: 25,
    lay: "Standing",
    backing: false,
    back: "White",
  },
  controls: (v) => [
    { key: "picture", label: "Picture", kind: "picture" },
    num("across", "Blocks across", 4, Math.max(4, acrossMost(readPicture(String(v.picture)))), 1),
    num("block", "Block size", 5, 100, 5, "cm"),
    choice("lay", "Stand", ["Standing", "On the floor"]),
    { key: "backing", label: "Backing behind it", kind: "toggle" },
    ...(v.backing ? [colour("back", "Backing")] : []),
  ],
  build: (v) => {
    const pic = readPicture(String(v.picture));
    if (!pic) return null;
    /* resampled to `across` cells, each the picture's cell under its middle, and no more than
       PICTURE_MOST the longer way */
    const w = Math.max(1, Math.min(numberIn(v, "across"), acrossMost(pic)));
    const h = Math.max(1, Math.min(Math.round((w * pic.h) / pic.w), PICTURE_MOST));
    const at = (x: number, y: number) =>
      pic.at(Math.floor(((x + 0.5) * pic.w) / w), Math.floor(((y + 0.5) * pic.h) / h));
    const cell = numberIn(v, "block");
    const depth = cell;
    const back = v.backing ? Math.max(5, cell / 2) : 0;
    const cells = cellBoxes(at, w, h, cell, cell, h * cell, back, depth);
    if (!cells.length) return null;
    const items = [
      ...(v.backing
        ? [piece("cube", [0, back / 2, 0], [w * cell, back, h * cell], colourIn(v, "back"))]
        : []),
      ...cells,
    ];
    if (v.lay === "Standing") return fileOf(facing(items));
    /* laid face up: its top row away from the camera (+X), its depth going up */
    return fileOf(
      items.map((it) => {
        const [x, y, z] = it.transform.location;
        const [sx, sy, sz] = it.transform.scale;
        return {
          ...it,
          transform: {
            ...it.transform,
            location: [z + (sz * 1000) / 2 - (h * cell) / 2, x, y - (sy * 1000) / 2] as V3,
            scale: [sz, sx, sy] as V3,
          },
        };
      }),
    );
  },
};

/* ---------- stairs ---------- */
export const stairs: Generator = {
  key: "stairs",
  name: "Stairs",
  category: "Useful",
  blurb: "A straight flight or a spiral staircase round a column, with handrails if you like.",
  file: "stairs",
  angle: { from: [-0.6, 0.6, 0.5], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    shape: "Straight",
    height: 4,
    width: 1.5,
    rise: 20,
    going: 30,
    rails: true,
    steps: "White",
    railc: "Dark",
  },
  controls: (v) => [
    choice("shape", "Shape", ["Straight", "Spiral"]),
    num("height", "Height", 0.5, 30, 0.5, "m"),
    num("width", "Width", 0.5, 6, 0.1, "m"),
    { key: "rails", label: "Handrails", kind: "toggle" },
    num("rise", "Step height", 10, 50, 1, "cm", true),
    num("going", "Step depth", 20, 80, 1, "cm", true),
    colour("steps", "Steps"),
    ...(v.rails || v.shape === "Spiral"
      ? [colour("railc", v.rails ? "Rails and column" : "Column")]
      : []),
  ],
  build: (v) => {
    const Ht = metresIn(v, "height");
    const n = Math.max(1, Math.round(Ht / numberIn(v, "rise")));
    const rise = Ht / n;
    const go = numberIn(v, "going");
    const w = metresIn(v, "width");
    const sc = colourIn(v, "steps");
    const rc = colourIn(v, "railc");
    const items: Array<PrefabItem> = [];
    const rail = 90;
    if (v.shape === "Spiral") {
      /* each step a tread out from a column, turned so its middle moves `go` round */
      const col = Math.max(30, w * 0.25);
      const mid = col / 2 + w / 2;
      const turn = go / mid;
      const tops: Array<V3> = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI + i * turn;
        const z = (i + 1) * rise;
        const c: V3 = [mid * Math.cos(a), mid * Math.sin(a), z - 6];
        items.push(
          boxAt(c, [go * ((col / 2 + w) / mid) + 4, w, 12], sc, [0, (a * 180) / Math.PI + 90, 0]),
        );
        tops.push([(col / 2 + w - 6) * Math.cos(a), (col / 2 + w - 6) * Math.sin(a), z + rail]);
      }
      items.push(piece("cylinder", [0, 0, 0], [col, col, Ht + (v.rails ? rail : 0)], rc));
      if (v.rails)
        for (let i = 0; i < n; i++) {
          const t = tops[i];
          items.push(stick([t[0], t[1], t[2] - rail], t, 5, rc));
          if (i + 1 < n) items.push(stick(t, tops[i + 1], 6, rc));
        }
      return fileOf(items);
    }
    /* a solid flight: each step a block from the floor to its tread, starting toward the camera */
    const run = n * go;
    for (let i = 0; i < n; i++)
      items.push(
        boxAt([-run / 2 + (i + 0.5) * go, 0, ((i + 1) * rise) / 2], [go, w, (i + 1) * rise], sc),
      );
    if (v.rails)
      for (const s of [-1, 1]) {
        const y = s * (w / 2 - 6);
        const at = (i: number): V3 => [-run / 2 + (i + 0.5) * go, y, (i + 1) * rise + rail];
        const every = Math.max(1, Math.round(150 / go));
        for (let i = 0; i < n; i += every)
          items.push(stick([at(i)[0], y, (i + 1) * rise], at(i), 5, rc));
        items.push(stick([at(n - 1)[0], y, n * rise], at(n - 1), 5, rc));
        if (n > 1) items.push(stick(at(0), at(n - 1), 6, rc));
      }
    return fileOf(items);
  },
};

/* ---------- bridge ---------- */
const BRIDGES = ["Arch", "Beam", "Suspension"] as const;
export const bridge: Generator = {
  key: "bridge",
  name: "Bridge",
  category: "Useful",
  blurb: "An arched, beam or suspension bridge across a gap, with railings.",
  file: "bridge",
  angle: { from: [-0.85, 0.15, 0.45], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    style: "Arch",
    span: 16,
    width: 3,
    rise: 2.5,
    rails: true,
    deck: "Copper",
    railc: "White",
    support: "Aluminum",
  },
  controls: (v) => [
    choice("style", "Style", BRIDGES),
    num("span", "Span", 4, 60, 1, "m"),
    num("width", "Width", 1, 10, 0.5, "m"),
    num(
      "rise",
      v.style === "Arch" ? "Arch height" : v.style === "Beam" ? "Deck height" : "Tower height",
      0.5,
      15,
      0.5,
      "m",
    ),
    { key: "rails", label: "Railings", kind: "toggle" },
    colour("deck", "Deck"),
    ...(v.rails ? [colour("railc", "Railings")] : []),
    ...(v.style === "Arch"
      ? []
      : [colour("support", v.style === "Beam" ? "Piers" : "Towers and cables")]),
  ],
  build: (v) => {
    const S = metresIn(v, "span");
    const w = metresIn(v, "width");
    const arch = v.style === "Arch";
    /* an arch no higher than a fifth of its span, so its ends slope at most about 45° */
    const R = arch ? Math.min(metresIn(v, "rise"), S / 5) : metresIn(v, "rise");
    const deck = colourIn(v, "deck");
    const sup = colourIn(v, "support");
    const thick = 30;
    /* the deck's centreline along Y, each point with its up */
    const n = Math.max(8, Math.ceil(S / 150));
    const base = v.style === "Beam" ? R : thick;
    /* a circular arch through both ends and its top R up */
    const rad = arch ? (S * S) / (8 * R) + R / 2 : 0;
    const line = Array.from({ length: n + 1 }, (_, i) => {
      const y = -S / 2 + (i / n) * S;
      if (!arch) return { p: [0, y, base] as V3, up: [0, 0, 1] as V3 };
      const zc = base + R - rad;
      const z = zc + Math.sqrt(Math.max(0, rad * rad - y * y));
      return { p: [0, y, z] as V3, up: norm([0, -y, z - zc]) };
    });
    const items: Array<PrefabItem> = [];
    for (let i = 0; i < n; i++)
      items.push(
        slab(
          line[i].p,
          line[i + 1].p,
          norm(add(line[i].up, line[i + 1].up)),
          w,
          thick,
          deck,
          arch ? 4 : 1,
        ),
      );
    if (v.rails) {
      const rc = colourIn(v, "railc");
      for (const s of [-1, 1]) {
        const tops = line.map((l) => add(l.p, [s * (w / 2 - 6), 0, 100]));
        line.forEach((l, i) => {
          if (i % Math.max(1, Math.round(n / Math.ceil(S / 200))) === 0 || i === n)
            items.push(stick(add(l.p, [s * (w / 2 - 6), 0, 0]), tops[i], 6, rc));
        });
        for (let i = 0; i < n; i++) items.push(stick(tops[i], tops[i + 1], 7, rc));
      }
    }
    if (v.style === "Beam") {
      /* a pair of piers at each end and at most every 8 m between */
      const k = Math.max(1, Math.ceil(S / 800));
      for (let i = 0; i <= k; i++) {
        const y = -S / 2 + 30 + (i / k) * (S - 60);
        for (const s of [-1, 1])
          items.push(piece("cylinder", [s * (w / 2 - 25), y, 0], [50, 50, R - thick], sup));
      }
    } else if (v.style === "Suspension") {
      /* a tower each end, a cable over both sagging to just above the deck, hangers down to it */
      const T = base + R;
      const ty = S / 2 - 40;
      for (const e of [-1, 1])
        for (const s of [-1, 1])
          items.push(boxAt([s * (w / 2 + 20), e * ty, T / 2], [40, 40, T], sup));
      for (const e of [-1, 1]) items.push(boxAt([0, e * ty, T - 30], [w + 80, 40, 40], sup));
      for (const s of [-1, 1]) {
        const x = s * (w / 2 + 20);
        const at = (y: number): V3 => [x, y, base + 120 + (T - base - 150) * (y / ty) ** 2];
        const k = Math.max(6, Math.ceil(S / 150));
        for (let i = 0; i < k; i++) {
          const y0 = -ty + (i / k) * 2 * ty;
          const y1 = -ty + ((i + 1) / k) * 2 * ty;
          items.push(stick(at(y0), at(y1), 8, sup));
          if (i > 0) items.push(stick([x, y0, base], at(y0), 4, sup));
        }
      }
    }
    return fileOf(items);
  },
};

/* ---------- floor tiles ---------- */
const PATTERNS = ["Checker", "Stripes", "Mosaic", "Border"] as const;
export const floorTiles: Generator = {
  key: "floor-tiles",
  name: "Floor tiles",
  category: "Useful",
  blurb: "A floor of tiles in a checker, stripes, a random mosaic or a border.",
  file: "floor_tiles",
  angle: { from: [-0.6, 0.45, 0.66], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    pattern: "Checker",
    across: 10,
    deep: 10,
    tile: 1,
    thick: 10,
    a: "White",
    b: "Dark",
    c: "Red",
    seed: 3,
  },
  controls: (v) => [
    choice("pattern", "Pattern", PATTERNS),
    num("across", "Tiles across", 1, 40, 1),
    num("deep", "Tiles deep", 1, 40, 1),
    num("tile", "Tile size", 0.25, 5, 0.25, "m"),
    num("thick", "Thickness", 5, 100, 5, "cm", true),
    colour("a", "First colour"),
    colour("b", "Second colour"),
    ...(v.pattern === "Mosaic" ? [colour("c", "Third colour"), SHUFFLE] : []),
  ],
  build: (v) => {
    const w = numberIn(v, "across");
    const h = numberIn(v, "deep");
    const t = metresIn(v, "tile");
    const th = numberIn(v, "thick");
    const [a, b, c] = [colourIn(v, "a"), colourIn(v, "b"), colourIn(v, "c")];
    const r = random(numberIn(v, "seed"));
    const mosaic = Array.from({ length: w * h }, () => [a, b, c][Math.floor(r() * 3)]);
    const colourAt = (x: number, y: number): Colour => {
      if (v.pattern === "Stripes") return y % 2 ? b : a;
      if (v.pattern === "Mosaic") return mosaic[y * w + x];
      if (v.pattern === "Border") return x === 0 || y === 0 || x === w - 1 || y === h - 1 ? a : b;
      return (x + y) % 2 ? b : a;
    };
    const items: Array<PrefabItem> = [];
    /* x across the camera's view is Y, y deep away from it is +X */
    for (const col of new Set([a, b, c]))
      for (const g of rects({ w, h, on: (x, y) => colourAt(x, y) === col } satisfies Grid))
        items.push(
          piece(
            "cube",
            [(-h / 2 + g.y + g.h / 2) * t, (-w / 2 + g.x + g.w / 2) * t, 0],
            [g.h * t, g.w * t, th],
            col,
          ),
        );
    return fileOf(items);
  },
};
