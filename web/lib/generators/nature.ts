// Nature (lib/generators/index.ts): Tree, Pine, Block tree and Bush, each seeded so Shuffle
// draws a new shape and the same seed the same one.
import type { PrefabItem } from "../prefab";
import {
  DEG,
  SHUFFLE,
  add,
  ball,
  colour,
  colourIn,
  fileOf,
  inBall,
  metresIn,
  mul,
  norm,
  num,
  numberIn,
  piece,
  random,
  rects,
  stick,
  turn,
  type Colour,
  type Control,
  type Generator,
  type V3,
  type Values,
} from "./pieces";

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

type TreeStyle = "Branches" | "Tiers" | "Voxel";
/* each tree style's own controls (keys prefixed by style) and the pieces it builds */
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
/* each tree style as a Generator of its own */
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
  defaults: { bark: "Copper", leaves: "Lime", seed: 5, ...defaults },
  controls: () => [
    ...STYLES[style].controls,
    colour("bark", "Trunk"),
    colour("leaves", "Leaves"),
    SHUFFLE,
  ],
  build: (v) => fileOf(STYLES[style].build(v)),
});
export const tree = treeOf(
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
export const pine = treeOf(
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
export const blockTree = treeOf(
  "block-tree",
  "Block tree",
  "An oak, birch, spruce or jungle tree out of blocks.",
  "Voxel",
  { "v.kind": "Oak", "v.cell": 50, "v.height": 11, "v.radius": 3, "v.holes": 15 },
);

export const bush: Generator = {
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
