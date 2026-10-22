// Buildings (lib/generators/index.ts): House, Tower and Castle, built from boxes round their
// openings and pitched or pyramid roofs, facing the camera that spawns them.
import type { PrefabItem } from "../prefab";
import {
  DEG,
  boxAt,
  colour,
  colourIn,
  fileOf,
  metresIn,
  num,
  numberIn,
  piece,
  pyramid,
  type Colour,
  type Generator,
  type V3,
} from "./pieces";

/* ---------- buildings ---------- */
/* A building's front faces -X, like a sign, so it faces the camera that spawns it; its width
   runs along Y and its depth along X, its ground floor on z = 0. */

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

/* a window: 100 cm wide, from a sill 90 cm up to a head at 200 cm */
const WINDOW = { width: 100, bottom: 90, top: 200 };
/* up to `n` windows spread evenly along a wall `length` long, as many as fit with 40 cm of wall
   between them and at the ends */
function windowsAlong(length: number, n: number): Array<Opening> {
  const fit = Math.min(n, Math.floor((length - 40) / (WINDOW.width + 40)));
  return Array.from({ length: Math.max(0, fit) }, (_, i) => ({
    ...WINDOW,
    at: ((i + 1) * length) / (fit + 1),
  }));
}

/* the openings' panes and sills on a wall: `place` turns a box given across the wall (u along
   it, out from its face, z up) into the world */
function glazing(
  holes: Array<Opening>,
  place: (
    u: number,
    out: number,
    z: number,
    along: number,
    thick: number,
    tall: number,
    c: Colour,
  ) => PrefabItem,
  glass: Colour,
  trim: Colour,
) {
  return holes
    .filter((o) => o.bottom > 0)
    .flatMap((o) => [
      place(o.at, 0, (o.bottom + o.top) / 2, o.width, 4, o.top - o.bottom, glass),
      place(o.at, 12, o.bottom - 5, o.width + 20, 24, 10, trim),
    ]);
}

const ROOFS = ["Gable", "Hip", "Flat"] as const;
export const house: Generator = {
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
    const trim = colourIn(v, "trim");
    const glass = colourIn(v, "glass");
    const n = numberIn(v, "windows");
    const items: Array<PrefabItem> = [boxAt([0, 0, 10], [D, W, 20], trim)];
    const DOOR = { at: W / 2, width: 110, bottom: 0, top: 220 };
    for (let f = 0; f < floors; f++) {
      const z = 20 + f * h;
      /* the front's windows, less any the door would meet */
      const front = windowsAlong(W, n).filter(
        (o) => !(f === 0 && v.door) || Math.abs(o.at - DOOR.at) >= (o.width + DOOR.width) / 2 + 20,
      );
      if (f === 0 && v.door) {
        front.push(DOOR);
        items.push(boxAt([-D / 2 + t / 2, 0, z + 110], [t / 2, 100, 210], trim));
      }
      /* front and back run across Y, out toward -X and +X */
      for (const [x, holes, out] of [
        [-D / 2 + t / 2, front, -1],
        [D / 2 - t / 2, windowsAlong(W, n), 1],
      ] as const) {
        items.push(
          ...wall(W, h, holes, (u0, u1, z0, z1) =>
            boxAt([x, -W / 2 + (u0 + u1) / 2, z + (z0 + z1) / 2], [t, u1 - u0, z1 - z0], walls),
          ),
          ...glazing(
            holes,
            (u, o, zz, along, thick, tall, c) =>
              boxAt([x + out * o, -W / 2 + u, z + zz], [thick, along, tall], c),
            glass,
            trim,
          ),
        );
      }
      /* the sides run along X between them, out toward -Y and +Y */
      const side = windowsAlong(D - 2 * t, n);
      for (const [y, out] of [
        [-W / 2 + t / 2, -1],
        [W / 2 - t / 2, 1],
      ] as const)
        items.push(
          ...wall(D - 2 * t, h, side, (u0, u1, z0, z1) =>
            boxAt([-D / 2 + t + (u0 + u1) / 2, y, z + (z0 + z1) / 2], [u1 - u0, t, z1 - z0], walls),
          ),
          ...glazing(
            side,
            (u, o, zz, along, thick, tall, c) =>
              boxAt([-D / 2 + t + u, y + out * o, z + zz], [along, thick, tall], c),
            glass,
            trim,
          ),
        );
      items.push(boxAt([0, 0, z + h - 10], [D, W, 20], walls));
    }
    const top = 20 + floors * h;
    const roofc = colourIn(v, "roofc");
    const eave = 40;
    const p = numberIn(v, "pitch");
    const tan = Math.tan(p * DEG);
    if (v.chimney) {
      /* from inside the roof to clear of its ridge, toward the back corner */
      const ridge =
        v.roof === "Flat"
          ? top + 80
          : v.roof === "Hip"
            ? top + tan * (Math.min(W, D) / 2)
            : top + tan * (D / 2);
      items.push(boxAt([D / 4, W / 4, (top + ridge + 60) / 2], [60, 60, ridge + 60 - top], trim));
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
export const tower: Generator = {
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
      for (let c = 0; c < cols; c++) {
        if (round) {
          const a = (c / cols) * Math.PI * 2;
          items.push(
            boxAt(
              [Math.cos(a) * (W / 2 - 15), Math.sin(a) * (W / 2 - 15), z + (n * h) / 2],
              [30, 30, n * h],
              frame,
            ),
          );
          continue;
        }
        /* across each face from corner to corner; the corners belong to the X faces */
        const u = cols === 1 ? 0 : -W / 2 + 15 + (c * (W - 30)) / (cols - 1);
        const corner = cols > 1 && (c === 0 || c === cols - 1);
        for (const [x, y] of [
          [-W / 2 + 15, u],
          [W / 2 - 15, u],
          ...(corner
            ? []
            : [
                [u, -W / 2 + 15],
                [u, W / 2 - 15],
              ]),
        ])
          items.push(boxAt([x, y, z + (n * h) / 2], [30, 30, n * h], frame));
      }
      z += n * h;
      /* step in only under a section that has floors to stand on it */
      if (floors - 1 - (s + 1) * per > 0) W *= 1 - numberIn(v, "step") / 100;
    }
    const tall = z;
    if (v.crown === "Spire") {
      const sw = W * 0.45;
      const rise = Math.min(sw * 3, tall * 0.25);
      items.push(
        round
          ? piece("cone", [0, 0, z + 20], [sw, sw, rise], top)
          : pyramid([0, 0, z + 20], sw, rise, top),
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

export const castle: Generator = {
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
    ...(Number(v.gate) > 0 ? [colour("gatec", "Gate")] : []),
  ],
  build: (v) => {
    const S = metresIn(v, "size");
    const H = metresIn(v, "height");
    const t = Math.max(60, S * 0.03);
    const stone = colourIn(v, "stone");
    const roofc = colourIn(v, "roofc");
    const items: Array<PrefabItem> = [];
    /* the gate and its two towers take at most two thirds of the front wall */
    const gt = Math.min(Math.max(320, metresIn(v, "gate") * 0.75), S * 0.12);
    const gate = Math.min(metresIn(v, "gate"), S * 0.66 - 2 * gt);
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
      for (let u = -S / 2 + step / 2; u + step <= S / 2; u += step * 2) {
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
