// PROTOTYPE: round 3, five ways to build a tree and a bush from the editor's primitives
// (A Cloud, B Branches, C Tiers, D Faceted, E Voxel), each with its own settings. A style is
// its controls (drawn generically by Generators.tsx), its defaults and its two builders.
import type { PrefabFile, PrefabItem } from "../../lib/prefab";
import { fileOf, piece, rand, rects, type Colour } from "./gen";

export type Ctl =
  | { k: string; label: string; t: "num"; min: number; max: number; step?: number; unit?: string }
  | { k: string; label: string; t: "colour" }
  | { k: string; label: string; t: "seg"; opts: ReadonlyArray<string> }
  | { k: string; label: string; t: "toggle" }
  | { k: string; label: string; t: "seed" };
export type Vals = Record<string, number | string | boolean>;
export interface Style {
  tree: { ctls: Array<Ctl>; defaults: Vals; build: (v: Vals) => PrefabFile };
  bush: { ctls: Array<Ctl>; defaults: Vals; build: (v: Vals) => PrefabFile };
}

type V3 = [number, number, number];
const n = (v: Vals, k: string) => Number(v[k]);
const c = (v: Vals, k: string) => v[k] as Colour;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const DEG = Math.PI / 180;

/* the [pitch, yaw, roll] that turns a piece's up axis to point along d (roll 0) */
function aim(d: V3): V3 {
  const [x, y, z] = norm(d);
  return [-Math.acos(Math.max(-1, Math.min(1, z))) / DEG, Math.atan2(y, x) / DEG, 0];
}
/* where the up axis points under [pitch, yaw, 0] */
function upOf([p, y]: V3): V3 {
  const P = p * DEG;
  const Y = y * DEG;
  return [-Math.sin(P) * Math.cos(Y), -Math.sin(P) * Math.sin(Y), Math.cos(P)];
}
/* a stick from a to b, `w` cm thick */
const stick = (a: V3, b: V3, w: number, col: Colour) => {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return piece("cylinder", a, [w, w, Math.hypot(...d)], col, aim(d));
};
/* a ball centred at p */
const ball = (p: V3, s: number, col: Colour, squash = 1) =>
  piece("sphere", [p[0], p[1], p[2] - (s * squash) / 2], [s, s, s * squash], col);
/* a cube centred at p, turned by rot */
const chunk = (p: V3, s: V3, rot: V3, col: Colour) =>
  piece("cube", add(p, mul(upOf(rot), -s[2] / 2)), s, col, rot);

/* a random point in a unit ball, kept towards its surface by `shell` (0 anywhere, 1 surface) */
function inBall(r: () => number, shell = 0.4): V3 {
  const a = r() * Math.PI * 2;
  const u = r() * 2 - 1;
  const d = Math.cbrt(shell + (1 - shell) * r());
  const s = Math.sqrt(1 - u * u);
  return [Math.cos(a) * s * d, Math.sin(a) * s * d, u * d];
}

const SEED: Ctl = { k: "seed", label: "Shuffle", t: "seed" };

/* ---------- A · Cloud: a trunk under a cloud of balls ---------- */
const cloud: Style = {
  tree: {
    ctls: [
      { k: "height", label: "Height", t: "num", min: 1, max: 40, step: 0.5, unit: "m" },
      { k: "trunk", label: "Trunk share", t: "num", min: 10, max: 80, step: 5, unit: "%" },
      { k: "girth", label: "Trunk width", t: "num", min: 0.1, max: 3, step: 0.05, unit: "m" },
      { k: "lean", label: "Lean", t: "num", min: 0, max: 35, unit: "°" },
      { k: "width", label: "Canopy width", t: "num", min: 1, max: 30, step: 0.5, unit: "m" },
      { k: "leaves", label: "Leaf balls", t: "num", min: 3, max: 80 },
      { k: "leaf", label: "Ball size", t: "num", min: 0.3, max: 6, step: 0.1, unit: "m" },
      { k: "bark", label: "Trunk", t: "colour" },
      { k: "green", label: "Leaves", t: "colour" },
      { k: "accent", label: "Second leaf colour", t: "colour" },
      { k: "mix", label: "Second colour share", t: "num", min: 0, max: 100, step: 5, unit: "%" },
      SEED,
    ],
    defaults: {
      height: 7,
      trunk: 40,
      girth: 0.4,
      lean: 6,
      width: 5,
      leaves: 24,
      leaf: 1.6,
      bark: "Copper",
      green: "Lime",
      accent: "Yellow",
      mix: 15,
      seed: 11,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const H = n(v, "height") * 100;
      const th = (H * n(v, "trunk")) / 100;
      const W = n(v, "width") * 100;
      const az = r() * Math.PI * 2;
      const lean = n(v, "lean") * DEG;
      const top: V3 = mul(
        [Math.sin(lean) * Math.cos(az), Math.sin(lean) * Math.sin(az), Math.cos(lean)],
        th,
      );
      const items: Array<PrefabItem> = [
        stick([0, 0, 0], add(top, [0, 0, 30]), n(v, "girth") * 100, c(v, "bark")),
      ];
      const leaf = n(v, "leaf") * 100;
      const ch = Math.max(leaf, H - th);
      const centre = add(top, [0, 0, ch / 2 - leaf * 0.15]);
      for (let i = 0; i < n(v, "leaves"); i++) {
        const p = inBall(r, 0.3);
        const s = leaf * (0.7 + r() * 0.6);
        const at = add(centre, [(p[0] * (W - s)) / 2, (p[1] * (W - s)) / 2, (p[2] * (ch - s)) / 2]);
        items.push(ball(at, s, r() * 100 < n(v, "mix") ? c(v, "accent") : c(v, "green")));
      }
      return fileOf(items);
    },
  },
  bush: {
    ctls: [
      { k: "width", label: "Width", t: "num", min: 0.3, max: 20, step: 0.1, unit: "m" },
      { k: "depth", label: "Depth", t: "num", min: 0.3, max: 20, step: 0.1, unit: "m" },
      { k: "height", label: "Height", t: "num", min: 0.2, max: 8, step: 0.1, unit: "m" },
      { k: "leaves", label: "Leaf balls", t: "num", min: 1, max: 60 },
      { k: "leaf", label: "Ball size", t: "num", min: 0.1, max: 4, step: 0.05, unit: "m" },
      { k: "green", label: "Leaves", t: "colour" },
      { k: "flowers", label: "Flowers", t: "num", min: 0, max: 80 },
      { k: "petal", label: "Flower colour", t: "colour" },
      SEED,
    ],
    defaults: {
      width: 2.4,
      depth: 1.8,
      height: 1.2,
      leaves: 16,
      leaf: 0.8,
      green: "Lime",
      flowers: 18,
      petal: "Red",
      seed: 4,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const W = n(v, "width") * 100;
      const D = n(v, "depth") * 100;
      const H = n(v, "height") * 100;
      const leaf = n(v, "leaf") * 100;
      const items: Array<PrefabItem> = [];
      for (let i = 0; i < n(v, "leaves"); i++) {
        const p = inBall(r, 0.2);
        const s = Math.min(leaf * (0.7 + r() * 0.6), H);
        const z = Math.max(s / 2, Math.abs(p[2]) * (H - s / 2));
        items.push(ball([(p[0] * (W - s)) / 2, (p[1] * (D - s)) / 2, z], s, c(v, "green")));
      }
      for (let i = 0; i < n(v, "flowers"); i++) {
        const p = norm(inBall(r, 1));
        const z = Math.abs(p[2]) * 0.85 + 0.15;
        items.push(
          ball(
            [(p[0] * W) / 2.1, (p[1] * D) / 2.1, z * H * 0.95],
            Math.max(8, H * 0.1),
            c(v, "petal"),
          ),
        );
      }
      return fileOf(items);
    },
  },
};

/* ---------- B · Branches: a trunk that forks, leaf clumps at the tips ---------- */
function turn(d: V3, angle: number, around: number): V3 {
  /* a direction `angle` away from d, at `around` radians about it */
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
function grow(
  v: Vals,
  r: () => number,
  items: Array<PrefabItem>,
  at: V3,
  dir: V3,
  len: number,
  width: number,
  level: number,
) {
  const end = add(at, mul(dir, len));
  items.push(stick(at, end, width, c(v, "bark")));
  if (level >= n(v, "levels")) {
    const s = n(v, "clump") * 100;
    for (let i = 0; i < n(v, "clumpBalls"); i++) {
      const p = inBall(r, 0);
      items.push(ball(add(end, mul(p, s * 0.45)), s * (0.6 + r() * 0.5), c(v, "green"), 0.8));
    }
    return;
  }
  const k = n(v, "forks");
  const spin = r() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const d = turn(dir, n(v, "angle") * DEG * (0.8 + r() * 0.4), spin + (i / k) * Math.PI * 2);
    const up = norm(add(d, [0, 0, 0.35]));
    grow(v, r, items, end, up, (len * n(v, "ratio")) / 100, width * 0.62, level + 1);
  }
}
const branches: Style = {
  tree: {
    ctls: [
      { k: "height", label: "Trunk length", t: "num", min: 0.5, max: 20, step: 0.5, unit: "m" },
      { k: "girth", label: "Trunk width", t: "num", min: 0.1, max: 3, step: 0.05, unit: "m" },
      { k: "levels", label: "Forks deep", t: "num", min: 1, max: 4 },
      { k: "forks", label: "Branches per fork", t: "num", min: 2, max: 5 },
      { k: "angle", label: "Branch angle", t: "num", min: 10, max: 80, unit: "°" },
      { k: "ratio", label: "Branch length", t: "num", min: 40, max: 95, step: 5, unit: "%" },
      { k: "clump", label: "Leaf clump size", t: "num", min: 0.3, max: 6, step: 0.1, unit: "m" },
      { k: "clumpBalls", label: "Balls per clump", t: "num", min: 1, max: 6 },
      { k: "bark", label: "Bark", t: "colour" },
      { k: "green", label: "Leaves", t: "colour" },
      SEED,
    ],
    defaults: {
      height: 3,
      girth: 0.45,
      levels: 2,
      forks: 3,
      angle: 35,
      ratio: 70,
      clump: 1.8,
      clumpBalls: 3,
      bark: "Copper",
      green: "Lime",
      seed: 5,
    },
    build: (v) => {
      const items: Array<PrefabItem> = [];
      grow(
        v,
        rand(n(v, "seed")),
        items,
        [0, 0, 0],
        [0, 0, 1],
        n(v, "height") * 100,
        n(v, "girth") * 100,
        0,
      );
      return fileOf(items);
    },
  },
  bush: {
    ctls: [
      { k: "stems", label: "Stems", t: "num", min: 1, max: 14 },
      { k: "height", label: "Stem length", t: "num", min: 0.2, max: 4, step: 0.1, unit: "m" },
      { k: "angle", label: "Spread", t: "num", min: 0, max: 70, unit: "°" },
      { k: "clump", label: "Leaf clump size", t: "num", min: 0.2, max: 3, step: 0.05, unit: "m" },
      { k: "clumpBalls", label: "Balls per clump", t: "num", min: 1, max: 6 },
      { k: "bark", label: "Stems", t: "colour" },
      { k: "green", label: "Leaves", t: "colour" },
      SEED,
    ],
    defaults: {
      stems: 7,
      height: 0.9,
      angle: 40,
      clump: 0.6,
      clumpBalls: 3,
      bark: "Copper",
      green: "Lime",
      seed: 8,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const items: Array<PrefabItem> = [];
      const k = n(v, "stems");
      const vv = { ...v, levels: 0 };
      for (let i = 0; i < k; i++) {
        const d = turn(
          [0, 0, 1],
          n(v, "angle") * DEG * (0.4 + r() * 0.6),
          (i / k) * Math.PI * 2 + r(),
        );
        grow(
          vv,
          r,
          items,
          [0, 0, 0],
          d,
          n(v, "height") * 100 * (0.7 + r() * 0.5),
          Math.max(4, n(v, "clump") * 12),
          0,
        );
      }
      return fileOf(items);
    },
  },
};

/* ---------- C · Tiers: stacked cones, and clipped topiary ---------- */
const tiers: Style = {
  tree: {
    ctls: [
      { k: "height", label: "Height", t: "num", min: 1, max: 40, step: 0.5, unit: "m" },
      {
        k: "width",
        label: "Width at the bottom",
        t: "num",
        min: 0.5,
        max: 20,
        step: 0.5,
        unit: "m",
      },
      { k: "tiers", label: "Tiers", t: "num", min: 1, max: 10 },
      { k: "taper", label: "Taper", t: "num", min: 0, max: 90, step: 5, unit: "%" },
      { k: "overlap", label: "Overlap", t: "num", min: 0, max: 80, step: 5, unit: "%" },
      { k: "stem", label: "Bare trunk", t: "num", min: 0, max: 10, step: 0.1, unit: "m" },
      { k: "snow", label: "Snow on each tier", t: "toggle" },
      { k: "bark", label: "Trunk", t: "colour" },
      { k: "green", label: "Needles", t: "colour" },
      { k: "cap", label: "Snow", t: "colour" },
      SEED,
    ],
    defaults: {
      height: 8,
      width: 4,
      tiers: 4,
      taper: 70,
      overlap: 40,
      stem: 1.6,
      snow: false,
      bark: "Copper",
      green: "Lime",
      cap: "White",
      seed: 2,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const H = n(v, "height") * 100;
      const W = n(v, "width") * 100;
      const stem = n(v, "stem") * 100;
      const k = n(v, "tiers");
      const ov = n(v, "overlap") / 100;
      const th = (H - stem) / (k - (k - 1) * ov);
      const items: Array<PrefabItem> = [
        stick([0, 0, 0], [0, 0, stem + th * 0.5], W * 0.08, c(v, "bark")),
      ];
      for (let i = 0; i < k; i++) {
        const w = W * (1 - ((n(v, "taper") / 100) * i) / Math.max(1, k - 1));
        const z = stem + i * th * (1 - ov);
        items.push(piece("cone", [0, 0, z], [w, w, th], c(v, "green"), r() * 360));
        if (v.snow)
          items.push(
            piece(
              "cone",
              [0, 0, z + th * 0.62],
              [w * 0.4, w * 0.4, th * 0.4],
              c(v, "cap"),
              r() * 360,
            ),
          );
      }
      return fileOf(items);
    },
  },
  bush: {
    ctls: [
      { k: "shape", label: "Shape", t: "seg", opts: ["Ball", "Hedge", "Cone", "Stack"] },
      { k: "width", label: "Width", t: "num", min: 0.2, max: 10, step: 0.1, unit: "m" },
      { k: "length", label: "Length", t: "num", min: 0.2, max: 40, step: 0.1, unit: "m" },
      { k: "height", label: "Height", t: "num", min: 0.2, max: 8, step: 0.1, unit: "m" },
      { k: "pot", label: "In a pot", t: "toggle" },
      { k: "green", label: "Leaves", t: "colour" },
      { k: "potc", label: "Pot", t: "colour" },
    ],
    defaults: {
      shape: "Stack",
      width: 1.2,
      length: 3,
      height: 1.8,
      pot: true,
      green: "Lime",
      potc: "Orange",
    },
    build: (v) => {
      const W = n(v, "width") * 100;
      const L = n(v, "length") * 100;
      const H = n(v, "height") * 100;
      const items: Array<PrefabItem> = [];
      const z0 = v.pot ? W * 0.45 : 0;
      if (v.pot) items.push(piece("cylinder", [0, 0, 0], [W * 0.6, W * 0.6, z0], c(v, "potc")));
      const g = c(v, "green");
      const h = H - z0;
      if (v.shape === "Ball") items.push(piece("sphere", [0, 0, z0], [W, W, h], g));
      else if (v.shape === "Cone") items.push(piece("cone", [0, 0, z0], [W, W, h], g));
      else if (v.shape === "Hedge") {
        items.push(piece("cube", [0, 0, z0], [L, W, h * 0.85], g));
        const k = Math.max(1, Math.round(L / W));
        for (let i = 0; i < k; i++)
          items.push(
            piece(
              "sphere",
              [-L / 2 + (i + 0.5) * (L / k), 0, z0 + h * 0.55],
              [(L / k) * 1.1, W, h * 0.45],
              g,
            ),
          );
      } else {
        const k = 3;
        for (let i = 0; i < k; i++) {
          const s = W * (1 - i * 0.25);
          items.push(piece("sphere", [0, 0, z0 + (i * h) / (k + 0.2)], [s, s, h / (k - 0.4)], g));
          if (i < k - 1)
            items.push(
              stick([0, 0, z0], [0, 0, z0 + ((i + 1) * h) / (k + 0.2)], W * 0.06, "Copper"),
            );
        }
      }
      return fileOf(items);
    },
  },
};

/* ---------- D · Faceted: tilted blocks, a low-poly look ---------- */
const faceted: Style = {
  tree: {
    ctls: [
      { k: "height", label: "Height", t: "num", min: 1, max: 40, step: 0.5, unit: "m" },
      { k: "segments", label: "Trunk blocks", t: "num", min: 1, max: 8 },
      { k: "girth", label: "Trunk width", t: "num", min: 0.1, max: 3, step: 0.05, unit: "m" },
      { k: "twist", label: "Trunk twist", t: "num", min: 0, max: 45, unit: "°" },
      { k: "chunks", label: "Leaf blocks", t: "num", min: 1, max: 40 },
      { k: "size", label: "Block size", t: "num", min: 0.3, max: 8, step: 0.1, unit: "m" },
      { k: "width", label: "Canopy width", t: "num", min: 1, max: 30, step: 0.5, unit: "m" },
      { k: "rough", label: "Tilt", t: "num", min: 0, max: 60, unit: "°" },
      { k: "bark", label: "Trunk", t: "colour" },
      { k: "green", label: "Leaves", t: "colour" },
      { k: "accent", label: "Second leaf colour", t: "colour" },
      { k: "mix", label: "Second colour share", t: "num", min: 0, max: 100, step: 5, unit: "%" },
      SEED,
    ],
    defaults: {
      height: 7,
      segments: 4,
      girth: 0.6,
      twist: 12,
      chunks: 9,
      size: 2.2,
      width: 4.5,
      rough: 30,
      bark: "Copper",
      green: "Lime",
      accent: "Yellow",
      mix: 20,
      seed: 9,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const H = n(v, "height") * 100;
      const size = n(v, "size") * 100;
      const W = n(v, "width") * 100;
      const th = H * 0.5;
      const k = n(v, "segments");
      const items: Array<PrefabItem> = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < k; i++) {
        const w = n(v, "girth") * 100 * (1 - i * (0.35 / k));
        items.push(
          piece("cube", [x, y, (i * th) / k], [w, w, th / k + 5], c(v, "bark"), i * n(v, "twist")),
        );
        x += (r() - 0.5) * w * 0.15;
        y += (r() - 0.5) * w * 0.15;
      }
      const ch = Math.max(size, H - th);
      const centre: V3 = [x, y, th + ch / 2 - size * 0.2];
      const t = n(v, "rough");
      for (let i = 0; i < n(v, "chunks"); i++) {
        const p = inBall(r, 0.25);
        const s = size * (0.65 + r() * 0.6);
        const at = add(centre, [(p[0] * (W - s)) / 2, (p[1] * (W - s)) / 2, (p[2] * (ch - s)) / 2]);
        const rot: V3 = [(r() - 0.5) * 2 * t, r() * 90, 0];
        items.push(
          chunk(
            at,
            [s, s, s * 0.85],
            rot,
            r() * 100 < n(v, "mix") ? c(v, "accent") : c(v, "green"),
          ),
        );
      }
      return fileOf(items);
    },
  },
  bush: {
    ctls: [
      { k: "chunks", label: "Leaf blocks", t: "num", min: 1, max: 30 },
      { k: "size", label: "Block size", t: "num", min: 0.1, max: 4, step: 0.05, unit: "m" },
      { k: "width", label: "Width", t: "num", min: 0.3, max: 20, step: 0.1, unit: "m" },
      { k: "height", label: "Height", t: "num", min: 0.2, max: 8, step: 0.1, unit: "m" },
      { k: "rough", label: "Tilt", t: "num", min: 0, max: 60, unit: "°" },
      { k: "green", label: "Leaves", t: "colour" },
      { k: "accent", label: "Second leaf colour", t: "colour" },
      { k: "mix", label: "Second colour share", t: "num", min: 0, max: 100, step: 5, unit: "%" },
      SEED,
    ],
    defaults: {
      chunks: 7,
      size: 0.8,
      width: 2,
      height: 1.1,
      rough: 25,
      green: "Lime",
      accent: "Yellow",
      mix: 0,
      seed: 6,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const size = n(v, "size") * 100;
      const W = n(v, "width") * 100;
      const H = n(v, "height") * 100;
      const t = n(v, "rough");
      const items: Array<PrefabItem> = [];
      for (let i = 0; i < n(v, "chunks"); i++) {
        const p = inBall(r, 0.2);
        const s = Math.min(H, size * (0.65 + r() * 0.6));
        const at: V3 = [
          (p[0] * (W - s)) / 2,
          (p[1] * (W - s)) / 2,
          s / 2 + Math.abs(p[2]) * Math.max(0, H - s),
        ];
        items.push(
          chunk(
            at,
            [s, s, s * 0.85],
            [(r() - 0.5) * 2 * t, r() * 90, 0],
            r() * 100 < n(v, "mix") ? c(v, "accent") : c(v, "green"),
          ),
        );
      }
      return fileOf(items);
    },
  },
};

/* ---------- E · Voxel: blocks on a grid, like a block game ---------- */
type Vox = Map<string, Colour>;
function voxFile(vox: Vox, cell: number): PrefabFile {
  const items: Array<PrefabItem> = [];
  const keys = [...vox.keys()].map((k) => k.split(",").map(Number));
  if (!keys.length) return fileOf(items);
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const zs = keys.map((k) => k[2]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const colours = new Set(vox.values());
  for (let z = Math.min(...zs); z <= Math.max(...zs); z++)
    for (const col of colours) {
      const g = { w, h, on: (x: number, y: number) => vox.get(`${x + x0},${y + y0},${z}`) === col };
      for (const rc of rects(g))
        items.push(
          piece(
            "cube",
            [(rc.x + x0 + rc.w / 2 - 0.5) * cell, (rc.y + y0 + rc.h / 2 - 0.5) * cell, z * cell],
            [rc.w * cell, rc.h * cell, cell],
            col,
          ),
        );
    }
  return fileOf(items);
}
const voxel: Style = {
  tree: {
    ctls: [
      { k: "species", label: "Kind", t: "seg", opts: ["Oak", "Birch", "Spruce", "Jungle"] },
      { k: "cell", label: "Block size", t: "num", min: 10, max: 200, step: 5, unit: "cm" },
      { k: "height", label: "Height", t: "num", min: 4, max: 40, unit: "blocks" },
      { k: "radius", label: "Canopy radius", t: "num", min: 1, max: 10, unit: "blocks" },
      { k: "holes", label: "Gaps in the leaves", t: "num", min: 0, max: 60, step: 5, unit: "%" },
      { k: "bark", label: "Trunk", t: "colour" },
      { k: "green", label: "Leaves", t: "colour" },
      SEED,
    ],
    defaults: {
      species: "Oak",
      cell: 50,
      height: 11,
      radius: 3,
      holes: 15,
      bark: "Copper",
      green: "Lime",
      seed: 3,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const H = n(v, "height");
      const R = n(v, "radius");
      const sp = v.species as string;
      const vox: Vox = new Map();
      const leaf = (x: number, y: number, z: number, edge: boolean) => {
        if (edge && r() * 100 < n(v, "holes")) return;
        if (!vox.has(`${x},${y},${z}`)) vox.set(`${x},${y},${z}`, c(v, "green"));
      };
      const thick = sp === "Jungle" ? 2 : 1;
      const trunkTop = sp === "Spruce" ? H - 1 : H - R;
      if (sp === "Spruce") {
        for (let z = 2; z <= H; z++) {
          const rad = Math.round(((H - z) / (H - 2)) * R * (z % 2 ? 1 : 0.7));
          for (let x = -rad; x <= rad; x++)
            for (let y = -rad; y <= rad; y++)
              if (Math.abs(x) + Math.abs(y) <= rad + 1)
                leaf(x, y, z, Math.abs(x) + Math.abs(y) >= rad);
        }
      } else if (sp === "Jungle") {
        for (const zc of [H - 2, Math.round(H * 0.6)])
          for (let z = zc; z <= zc + 1; z++) {
            const rad = z === zc ? R + 1 : R - 1;
            for (let x = -rad; x <= rad + 1; x++)
              for (let y = -rad; y <= rad + 1; y++)
                if ((x - 0.5) ** 2 + (y - 0.5) ** 2 <= rad * rad)
                  leaf(x, y, z, (x - 0.5) ** 2 + (y - 0.5) ** 2 > (rad - 1) ** 2);
          }
      } else {
        const rz = sp === "Birch" ? R * 1.6 : R;
        const rx = sp === "Birch" ? Math.max(1, R - 1) : R;
        const cz = H - rz;
        for (let x = -rx; x <= rx; x++)
          for (let y = -rx; y <= rx; y++)
            for (let z = Math.round(cz - rz); z <= Math.round(cz + rz); z++) {
              const d = (x / rx) ** 2 + (y / rx) ** 2 + ((z - cz) / rz) ** 2;
              if (d <= 1.05) leaf(x, y, z, d > 0.55);
            }
      }
      for (let z = 0; z < trunkTop; z++)
        for (let x = 0; x < thick; x++)
          for (let y = 0; y < thick; y++) vox.set(`${x},${y},${z}`, c(v, "bark"));
      return voxFile(vox, n(v, "cell"));
    },
  },
  bush: {
    ctls: [
      { k: "cell", label: "Block size", t: "num", min: 10, max: 200, step: 5, unit: "cm" },
      { k: "radius", label: "Radius", t: "num", min: 1, max: 8, unit: "blocks" },
      { k: "height", label: "Height", t: "num", min: 1, max: 8, unit: "blocks" },
      { k: "holes", label: "Gaps in the leaves", t: "num", min: 0, max: 60, step: 5, unit: "%" },
      { k: "green", label: "Leaves", t: "colour" },
      { k: "berries", label: "Berries", t: "num", min: 0, max: 30 },
      { k: "berry", label: "Berry colour", t: "colour" },
      SEED,
    ],
    defaults: {
      cell: 40,
      radius: 2,
      height: 2,
      holes: 20,
      green: "Lime",
      berries: 4,
      berry: "Red",
      seed: 2,
    },
    build: (v) => {
      const r = rand(n(v, "seed"));
      const R = n(v, "radius");
      const H = n(v, "height");
      const vox: Vox = new Map();
      const shell: Array<string> = [];
      for (let x = -R; x <= R; x++)
        for (let y = -R; y <= R; y++)
          for (let z = 0; z < H; z++) {
            const d = (x / (R + 0.5)) ** 2 + (y / (R + 0.5)) ** 2 + (z / H) ** 2;
            if (d > 1) continue;
            const edge = d > 0.5;
            if (edge && r() * 100 < n(v, "holes")) continue;
            vox.set(`${x},${y},${z}`, c(v, "green"));
            if (edge) shell.push(`${x},${y},${z}`);
          }
      for (let i = 0; i < n(v, "berries") && shell.length; i++)
        vox.set(shell.splice(Math.floor(r() * shell.length), 1)[0], c(v, "berry"));
      return voxFile(vox, n(v, "cell"));
    },
  },
};

export const STYLES: Record<"A" | "B" | "C" | "D" | "E", Style> = {
  A: cloud,
  B: branches,
  C: tiers,
  D: faceted,
  E: voxel,
};
