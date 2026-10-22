// Decor (lib/generators/index.ts): Lamp post, Fountain, Trophy, Fence and Finish arch, things to
// stand round a course. Anything with a front faces -X, toward the camera that spawns it; a row
// of lamps or a line of fence runs across it, along Y.
import type { PrefabItem } from "../prefab";
import {
  add,
  ball,
  boxAt,
  colour,
  colourIn,
  fileOf,
  metresIn,
  mul,
  num,
  numberIn,
  piece,
  pyramid,
  stick,
  type Colour,
  type Generator,
  type V3,
} from "./pieces";

/* a cone hanging point down from `at`, its wide end there */
const hung = (at: V3, d: number, h: number, c: Colour) =>
  piece("cone", at, [d, d, h], c, [180, 0, 0]);
const choice = (key: string, label: string, options: ReadonlyArray<string>, more = false) => ({
  key,
  label,
  kind: "choice" as const,
  options,
  more,
});

/* ---------- lamp post ---------- */
const LAMPS = ["Street", "Lantern", "Globe", "Double"] as const;
/* one lamp `H` cm tall standing at `at` */
function lamp(style: string, at: V3, H: number, pole: Colour, light: Colour): Array<PrefabItem> {
  const d = Math.max(12, H * 0.035);
  const items = [
    piece("cylinder", at, [d * 2.6, d * 2.6, Math.max(30, H * 0.06)], pole),
    piece("cylinder", at, [d, d, H], pole),
  ];
  const top = add(at, [0, 0, H]);
  if (style === "Street") {
    /* an arm out over the road in front, a shade hanging off its end over a bulb */
    const a = Math.max(80, H * 0.28);
    const bend = add(top, [-a * 0.55, 0, a * 0.22]);
    const end = add(top, [-a, 0, a * 0.12]);
    items.push(stick(add(top, [0, 0, -d]), bend, d * 0.8, pole), stick(bend, end, d * 0.8, pole));
    items.push(hung(add(end, [0, 0, d * 0.4]), a * 0.42, a * 0.2, pole));
    items.push(ball(add(end, [0, 0, -a * 0.16]), a * 0.18, light, 0.7));
  } else if (style === "Lantern") {
    const L = Math.max(30, H * 0.09);
    items.push(boxAt(add(top, [0, 0, 5]), [L * 0.8, L * 0.8, 10], pole));
    items.push(boxAt(add(top, [0, 0, 10 + L * 0.6]), [L * 0.7, L * 0.7, L * 1.2], light));
    items.push(pyramid(add(top, [0, 0, 10 + L * 1.2]), L, L * 0.55, pole));
  } else if (style === "Globe") {
    const g = Math.max(40, H * 0.13);
    items.push(piece("cylinder", top, [d * 1.8, d * 1.8, g * 0.15], pole));
    items.push(ball(add(top, [0, 0, g * 0.6]), g, light));
  } else {
    /* a crossbar along Y with a globe hanging under each end */
    const a = Math.max(60, H * 0.22);
    items.push(stick(add(top, [0, -a, 0]), add(top, [0, a, 0]), d * 0.8, pole));
    for (const s of [-1, 1]) {
      const end = add(top, [0, s * a, 0]);
      items.push(stick(end, add(end, [0, 0, -a * 0.25]), d * 0.4, pole));
      items.push(ball(add(end, [0, 0, -a * 0.25 - a * 0.16]), a * 0.32, light));
    }
  }
  return items;
}

export const lampPost: Generator = {
  key: "lamp",
  name: "Lamp post",
  category: "Decor",
  blurb: "A street lamp, lantern, globe or double lamp, one or a row of them.",
  file: "lamp_post",
  angle: { from: [-0.8, 0.45, 0.4], zoom: 1, pan: [0, 0, 0] },
  defaults: { style: "Street", height: 5, count: 1, spacing: 6, pole: "Dark", light: "Yellow" },
  controls: (v) => [
    choice("style", "Style", LAMPS),
    num("height", "Height", 2, 15, 0.5, "m"),
    num("count", "How many", 1, 12, 1),
    ...(Number(v.count) > 1 ? [num("spacing", "Spacing", 2, 30, 0.5, "m")] : []),
    colour("pole", "Post"),
    colour("light", "Light"),
  ],
  build: (v) => {
    const n = numberIn(v, "count");
    const gap = metresIn(v, "spacing");
    return fileOf(
      Array.from({ length: n }, (_, i) =>
        lamp(
          String(v.style),
          [0, (i - (n - 1) / 2) * gap, 0],
          metresIn(v, "height"),
          colourIn(v, "pole"),
          colourIn(v, "light"),
        ),
      ).flat(),
    );
  },
};

/* ---------- fountain ---------- */
/* a rim `t` thick and `h` tall round a pool `w` across, round (in 24 pieces) or square */
function rim(round: boolean, w: number, t: number, h: number, z: number, c: Colour) {
  if (!round)
    return [
      boxAt([-w / 2 + t / 2, 0, z + h / 2], [t, w, h], c),
      boxAt([w / 2 - t / 2, 0, z + h / 2], [t, w, h], c),
      boxAt([0, -w / 2 + t / 2, z + h / 2], [w - 2 * t, t, h], c),
      boxAt([0, w / 2 - t / 2, z + h / 2], [w - 2 * t, t, h], c),
    ];
  const n = 24;
  const r = w / 2 - t / 2;
  /* each piece long enough to meet its neighbours at the rim's outside */
  const len = 2 * (w / 2) * Math.tan(Math.PI / n) + 2;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return boxAt([r * Math.cos(a), r * Math.sin(a), z + h / 2], [t, len, h], c, [
      0,
      (a * 180) / Math.PI,
      0,
    ]);
  });
}

export const fountain: Generator = {
  key: "fountain",
  name: "Fountain",
  category: "Decor",
  blurb: "A pool with a rim, bowls stacked on a column and a jet of water at the top.",
  file: "fountain",
  defaults: { shape: "Round", width: 6, tiers: 3, jet: true, stone: "White", water: "Sky blue" },
  controls: () => [
    choice("shape", "Pool", ["Round", "Square"]),
    num("width", "Width", 2, 30, 0.5, "m"),
    num("tiers", "Tiers", 1, 4, 1),
    { key: "jet", label: "Jet of water", kind: "toggle" },
    colour("stone", "Stone"),
    colour("water", "Water"),
  ],
  build: (v) => {
    const W = metresIn(v, "width");
    const round = v.shape === "Round";
    const stone = colourIn(v, "stone");
    const water = colourIn(v, "water");
    const t = Math.max(20, W * 0.05);
    const h = Math.max(40, W * 0.08);
    const floor = (d: number, ht: number, z: number, c: Colour) =>
      round
        ? piece("cylinder", [0, 0, z], [d, d, ht], c)
        : boxAt([0, 0, z + ht / 2], [d, d, ht], c);
    const items: Array<PrefabItem> = [
      floor(W, 10, 0, stone),
      ...rim(round, W, t, h, 0, stone),
      floor(W - 2 * t - 2, h * 0.7, 10, water),
    ];
    /* bowls up a column, each narrower than the one below */
    const tiers = numberIn(v, "tiers");
    let z = h;
    let d = W * 0.5;
    const col = Math.max(20, W * 0.06);
    for (let i = 1; i < tiers; i++) {
      z += W * 0.16 * 0.8 ** i;
      items.push(hung([0, 0, z], d, d * 0.3, stone));
      items.push(piece("cylinder", [0, 0, z - 4], [d * 0.9, d * 0.9, 10], water));
      d *= 0.62;
    }
    if (tiers > 1) items.push(piece("cylinder", [0, 0, 0], [col, col, z], stone));
    if (v.jet) {
      const jh = Math.max(60, W * 0.12);
      items.push(piece("cylinder", [0, 0, z], [col * 0.4, col * 0.4, jh], water));
      items.push(ball([0, 0, z + jh], Math.max(40, W * 0.08), water, 0.8));
    }
    return fileOf(items);
  },
};

/* ---------- trophy ---------- */
export const trophy: Generator = {
  key: "trophy",
  name: "Trophy",
  category: "Decor",
  blurb: "A winner's cup, or a ball on a stem, up on a stepped plinth.",
  file: "trophy",
  defaults: { top: "Cup", height: 4, steps: 2, handles: true, metal: "Yellow", plinth: "Dark" },
  controls: (v) => [
    choice("top", "Top", ["Cup", "Ball"]),
    num("height", "Height", 1, 20, 0.5, "m"),
    num("steps", "Plinth steps", 0, 3, 1),
    ...(v.top === "Cup" ? [{ key: "handles", label: "Handles", kind: "toggle" as const }] : []),
    colour("metal", "Trophy"),
    ...(Number(v.steps) > 0 ? [colour("plinth", "Plinth")] : []),
  ],
  build: (v) => {
    const steps = numberIn(v, "steps");
    /* a unit: the plinth's steps are 0.6 of one each, the trophy 9.3 */
    const u = metresIn(v, "height") / (9.3 + steps * 0.6);
    const metal = colourIn(v, "metal");
    const items: Array<PrefabItem> = [];
    for (let i = 0; i < steps; i++) {
      const w = (4.4 - i * 0.7) * u;
      items.push(boxAt([0, 0, (i + 0.5) * 0.6 * u], [w, w, 0.6 * u], colourIn(v, "plinth")));
    }
    let z = steps * 0.6 * u;
    items.push(piece("cylinder", [0, 0, z], [2.4 * u, 2.4 * u, 0.5 * u], metal));
    items.push(pyramid([0, 0, z + 0.5 * u], 1.6 * u, 0.8 * u, metal));
    items.push(piece("cylinder", [0, 0, z + 0.5 * u], [0.5 * u, 0.5 * u, 3 * u], metal));
    items.push(ball([0, 0, z + 2.6 * u], 0.9 * u, metal));
    z += 3.5 * u;
    if (v.top === "Ball") {
      items.push(piece("cylinder", [0, 0, z - 0.2 * u], [1.4 * u, 1.4 * u, 0.4 * u], metal));
      items.push(ball([0, 0, z + 2.9 * u], 5.8 * u, metal));
      return fileOf(items);
    }
    /* a cup widening up to its rim from a point on the stem */
    const top = z + 5.5 * u;
    items.push(hung([0, 0, top], 4.4 * u, 6 * u, metal));
    items.push(piece("cylinder", [0, 0, top], [4.6 * u, 4.6 * u, 0.3 * u], metal));
    if (v.handles)
      for (const s of [-1, 1]) {
        /* a half ring out from the side of the cup, from under its rim down to its middle */
        const k = 6;
        const pts = Array.from({ length: k + 1 }, (_, i): V3 => {
          const a = (i / k) * Math.PI;
          return [
            0,
            s * (1.7 * u + Math.sin(a) * 1.3 * u),
            top - 0.7 * u - (1 - Math.cos(a)) * 1.3 * u,
          ];
        });
        for (let i = 0; i < k; i++) items.push(stick(pts[i], pts[i + 1], 0.35 * u, metal));
      }
    return fileOf(items);
  },
};

/* ---------- fence ---------- */
const FENCES = ["Picket", "Rail", "Bars", "Wall"] as const;
/* one run of fence from a to b along the ground, `H` cm tall, posts at most `gap` apart */
function fenceRun(style: string, a: V3, b: V3, H: number, gap: number, c: Colour, top: Colour) {
  const d: V3 = [b[0] - a[0], b[1] - a[1], 0];
  const len = Math.hypot(d[0], d[1]);
  if (len < 1) return [];
  const yaw = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  const at = (u: number, z: number): V3 => add(add(a, mul(d, u / len)), [0, 0, z]);
  /* a box `l` long along the run, `t` thick, `h` tall, its middle `u` along and `z` up */
  const bar = (u: number, z: number, l: number, t: number, h: number, col: Colour) =>
    boxAt(at(u, z), [l, t, h], col, [0, yaw, 0]);
  const items: Array<PrefabItem> = [];
  if (style === "Wall") {
    const t = Math.max(30, H * 0.3);
    items.push(bar(len / 2, H / 2, len, t, H, c));
    items.push(bar(len / 2, H + 6, len + 10, t + 16, 12, top));
    return items;
  }
  const posts = Math.max(1, Math.ceil(len / gap));
  const pt = Math.max(10, H * 0.08);
  for (let i = 0; i <= posts; i++) {
    const u = (i / posts) * len;
    if (style === "Bars") {
      items.push(piece("cylinder", at(u, 0), [pt * 1.3, pt * 1.3, H * 1.05], c));
      items.push(ball(at(u, H * 1.05 + pt * 0.6), pt * 1.6, top));
    } else items.push(bar(u, (H * 1.05) / 2, pt, pt, H * 1.05, c));
  }
  if (style === "Rail") {
    for (const z of [0.3, 0.62, 0.92])
      items.push(bar(len / 2, H * z, len, pt * 0.5, pt * 0.9, top));
    return items;
  }
  /* two rails behind the pickets or bars, and the pickets or bars between the posts */
  for (const z of style === "Bars" ? [0.15, 0.85] : [0.25, 0.7])
    items.push(bar(len / 2, H * z, len, pt * 0.5, pt * 0.6, c));
  const w = style === "Bars" ? Math.max(3, H * 0.025) : Math.max(8, H * 0.08);
  const step = style === "Bars" ? Math.max(12, H * 0.09) : w * 2;
  const k = Math.floor(len / step);
  for (let j = 0; j < k; j++) {
    const u = (j + 0.5) * (len / k);
    if (style === "Bars") items.push(piece("cylinder", at(u, 0), [w, w, H], c));
    else {
      items.push(bar(u, (H * 0.88) / 2, w, w * 0.4, H * 0.88, top));
      /* a point: a square turned on its corner, its lower half inside the board */
      items.push(
        boxAt(at(u, H * 0.88), [w / Math.SQRT2, w * 0.4, w / Math.SQRT2], top, [45, yaw, 0]),
      );
    }
  }
  return items;
}

export const fence: Generator = {
  key: "fence",
  name: "Fence",
  category: "Decor",
  blurb: "A picket fence, ranch rails, iron bars or a low wall, in a line or round a square pen.",
  file: "fence",
  angle: { from: [-0.85, 0.3, 0.4], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    style: "Picket",
    shape: "Line",
    length: 10,
    height: 1.2,
    spacing: 2.5,
    gate: true,
    posts: "White",
    boards: "White",
  },
  controls: (v) => [
    choice("style", "Style", FENCES),
    choice("shape", "Shape", ["Line", "Pen"]),
    num("length", v.shape === "Pen" ? "Side" : "Length", 1, 60, 0.5, "m"),
    num("height", "Height", 0.5, 4, 0.1, "m"),
    ...(v.shape === "Pen"
      ? [{ key: "gate", label: "Gap for a gate", kind: "toggle" as const }]
      : []),
    ...(v.style === "Wall" ? [] : [num("spacing", "Post spacing", 1, 6, 0.5, "m", true)]),
    colour("posts", v.style === "Wall" ? "Wall" : "Posts"),
    colour("boards", v.style === "Wall" ? "Top" : v.style === "Bars" ? "Tips" : "Boards and rails"),
  ],
  build: (v) => {
    const L = metresIn(v, "length");
    const H = metresIn(v, "height");
    const run = (a: V3, b: V3) =>
      fenceRun(
        String(v.style),
        a,
        b,
        H,
        metresIn(v, "spacing"),
        colourIn(v, "posts"),
        colourIn(v, "boards"),
      );
    if (v.shape !== "Pen") return fileOf(run([0, -L / 2, 0], [0, L / 2, 0]));
    const h = L / 2;
    /* the front (-X) side has the gate, 2 m wide, or a third of the side if that is less */
    const g = v.gate ? Math.min(200, L / 3) / 2 : 0;
    const front = g
      ? [run([-h, -h, 0], [-h, -g, 0]), run([-h, g, 0], [-h, h, 0])]
      : [run([-h, -h, 0], [-h, h, 0])];
    return fileOf(
      [
        ...front,
        run([-h, h, 0], [h, h, 0]),
        run([h, h, 0], [h, -h, 0]),
        run([h, -h, 0], [-h, -h, 0]),
      ].flat(),
    );
  },
};

/* ---------- finish arch ---------- */
export const finishArch: Generator = {
  key: "finish-arch",
  name: "Finish arch",
  category: "Decor",
  blurb: "Two pillars and a checkered banner across the track, with flags on top.",
  file: "finish_arch",
  angle: { from: [-0.85, 0.3, 0.42], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    width: 8,
    height: 5,
    banner: 1.2,
    rows: 2,
    pillars: "Square",
    flags: true,
    pillarc: "Dark",
    checkA: "Dark",
    checkB: "White",
    flagc: "Red",
  },
  controls: (v) => [
    num("width", "Width", 3, 30, 0.5, "m"),
    num("height", "Height", 3, 15, 0.5, "m"),
    num("banner", "Banner depth", 0.5, 4, 0.1, "m"),
    choice("pillars", "Pillars", ["Square", "Round"]),
    { key: "flags", label: "Flags on top", kind: "toggle" },
    num("rows", "Rows of checks", 1, 6, 1, undefined, true),
    colour("pillarc", "Pillars"),
    colour("checkA", "Checks"),
    colour("checkB", "Between the checks"),
    ...(v.flags ? [colour("flagc", "Flags")] : []),
  ],
  build: (v) => {
    const W = metresIn(v, "width");
    const H = metresIn(v, "height");
    const B = Math.min(metresIn(v, "banner"), H - 100);
    const P = Math.max(60, H * 0.1);
    const pc = colourIn(v, "pillarc");
    const items: Array<PrefabItem> = [];
    for (const s of [-1, 1]) {
      const y = s * (W / 2 + P / 2);
      items.push(
        v.pillars === "Round"
          ? piece("cylinder", [0, y, 0], [P, P, H + 20], pc)
          : boxAt([0, y, (H + 20) / 2], [P, P, H + 20], pc),
      );
      if (v.flags) {
        const mast: V3 = [0, y, H + 20];
        const m = Math.max(100, H * 0.25);
        items.push(stick(mast, add(mast, [0, 0, m]), Math.max(6, P * 0.12), pc));
        items.push(
          boxAt(
            add(mast, [0, s * m * 0.3, m * 0.8]),
            [4, m * 0.55, m * 0.36],
            colourIn(v, "flagc"),
          ),
        );
      }
    }
    /* the banner between the pillars, its checks raised a little on both faces */
    const depth = 30;
    items.push(boxAt([0, 0, H - B / 2], [depth, W, B], colourIn(v, "checkB")));
    const rows = numberIn(v, "rows");
    const cell = B / rows;
    const cols = Math.max(1, Math.round(W / cell));
    const cw = W / cols;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        if ((i + j) % 2 === 0)
          for (const x of [-1, 1])
            items.push(
              boxAt(
                [x * (depth / 2 + 2), -W / 2 + (i + 0.5) * cw, H - (j + 0.5) * cell],
                [4, cw, cell],
                colourIn(v, "checkA"),
              ),
            );
    return fileOf(items);
  },
};
