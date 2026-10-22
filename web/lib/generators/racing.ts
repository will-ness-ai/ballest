// Racing (lib/generators/index.ts): course pieces a ball rolls along, Spiral ramp, Loop, Jump,
// Plinko board and Rollers, each a chain of slabs (`slab`) whose tops make the track, walls on
// either side if you like. A track starts on the camera's side and heads away from it (+X).
import type { PrefabItem } from "../prefab";
import {
  add,
  boxAt,
  colour,
  colourIn,
  cross,
  fileOf,
  grounded,
  metresIn,
  mul,
  norm,
  num,
  numberIn,
  piece,
  slab,
  sub,
  type Colour,
  type Generator,
  type V3,
} from "./pieces";

/* a track slab's depth, and its walls' height and thickness, in cm */
const THICK = 30;
const WALL = 60;
const WALL_T = 15;

/* a point on a track's centreline, its surface facing `up` */
interface Stop {
  p: V3;
  up: V3;
}
interface Track {
  width: number;
  track: Colour;
  /* none: no walls */
  walls?: Colour;
}
/* the slabs from each stop to the next, `over` cm longer at each end (a bend's outer edge needs
   it), and with walls each side's wall standing on the slab's edge */
function trackOf(
  stops: Array<Stop>,
  t: Track,
  over: (i: number) => number = () => 2,
): Array<PrefabItem> {
  const items: Array<PrefabItem> = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i].p;
    const b = stops[i + 1].p;
    const up = norm(add(stops[i].up, stops[i + 1].up));
    items.push(slab(a, b, up, t.width, THICK, t.track, over(i)));
    if (!t.walls) continue;
    const side = norm(cross(up, sub(b, a)));
    for (const s of [-1, 1]) {
      const shift = add(mul(side, s * (t.width / 2 + WALL_T / 2)), mul(up, WALL));
      items.push(
        slab(add(a, shift), add(b, shift), up, WALL_T, WALL + THICK, t.walls, over(i) + WALL_T),
      );
    }
  }
  return items;
}

/* a straight run from a to b, its surface facing up */
const straight = (a: V3, b: V3): Array<Stop> => [
  { p: a, up: [0, 0, 1] },
  { p: b, up: [0, 0, 1] },
];
const wallsIn = (v: Record<string, unknown>, key: string, c: Colour) => (v[key] ? c : undefined);

/* ---------- spiral ramp ---------- */
export const spiral: Generator = {
  key: "spiral",
  name: "Spiral ramp",
  category: "Racing",
  blurb: "A banked track winding down round a column, from the top to the floor.",
  file: "spiral_ramp",
  angle: { from: [-0.75, 0.4, 0.55], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    radius: 6,
    turns: 2,
    drop: 4,
    width: 3,
    bank: 10,
    steps: 24,
    walls: true,
    column: true,
    track: "White",
    wallc: "Red",
    columnc: "Aluminum",
  },
  controls: (v) => [
    num("radius", "Radius", 2, 30, 0.5, "m"),
    num("turns", "Turns", 0.5, 6, 0.25),
    num("drop", "Drop per turn", 1, 20, 0.5, "m"),
    num("width", "Track width", 1, 8, 0.5, "m"),
    { key: "walls", label: "Walls", kind: "toggle" },
    { key: "column", label: "Column in the middle", kind: "toggle" },
    num("bank", "Banking", 0, 30, 1, "°", true),
    num("steps", "Pieces a turn", 8, 64, 1, undefined, true),
    colour("track", "Track"),
    ...(v.walls ? [colour("wallc", "Walls")] : []),
    ...(v.column ? [colour("columnc", "Column")] : []),
  ],
  build: (v) => {
    const w = metresIn(v, "width");
    /* the centreline's radius, at least far enough out that the inner edge clears the middle */
    const r = Math.max(metresIn(v, "radius"), w / 2 + 50);
    const turns = numberIn(v, "turns");
    const drop = metresIn(v, "drop");
    const n = Math.max(2, Math.ceil(turns * numberIn(v, "steps")));
    const step = (turns * Math.PI * 2) / n;
    const bank = numberIn(v, "bank") * (Math.PI / 180);
    const top = THICK + drop * turns;
    /* it starts on the camera's side (-X) and winds anticlockwise seen from above */
    const stops: Array<Stop> = Array.from({ length: n + 1 }, (_, i) => {
      const a = Math.PI + i * step;
      const inward: V3 = [-Math.cos(a), -Math.sin(a), 0];
      return {
        p: [r * Math.cos(a), r * Math.sin(a), top - (drop * i * step) / (Math.PI * 2)],
        up: norm(add([0, 0, Math.cos(bank)], mul(inward, Math.sin(bank)))),
      };
    });
    /* the outer edge's chord is longer than the centreline's by (r + w/2) / r */
    const chord = 2 * r * Math.sin(step / 2);
    const items = trackOf(
      stops,
      { width: w, track: colourIn(v, "track"), walls: wallsIn(v, "walls", colourIn(v, "wallc")) },
      () => (chord * (w / 2 + WALL_T)) / (2 * r) + 5,
    );
    if (v.column) {
      const d = Math.max(40, 2 * (r - w / 2) - 60);
      items.push(piece("cylinder", [0, 0, 0], [d, d, top + WALL], colourIn(v, "columnc")));
    }
    return fileOf(grounded(items));
  },
};

/* ---------- loop ---------- */
export const loop: Generator = {
  key: "loop",
  name: "Loop",
  category: "Racing",
  blurb: "A loop-the-loop: in along a straight, once round, and out beside where it came in.",
  file: "loop",
  angle: { from: [-0.35, 0.9, 0.35], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    radius: 4,
    width: 3,
    lead: 8,
    steps: 32,
    walls: true,
    track: "Blue",
    wallc: "White",
  },
  controls: (v) => [
    num("radius", "Radius", 2, 15, 0.5, "m"),
    num("width", "Track width", 1, 6, 0.5, "m"),
    num("lead", "Straight in and out", 0, 30, 1, "m"),
    { key: "walls", label: "Walls", kind: "toggle" },
    num("steps", "Pieces in the loop", 12, 72, 1, undefined, true),
    colour("track", "Track"),
    ...(v.walls ? [colour("wallc", "Walls")] : []),
  ],
  build: (v) => {
    const R = metresIn(v, "radius");
    const w = metresIn(v, "width");
    const lead = metresIn(v, "lead");
    const n = numberIn(v, "steps");
    /* the way out runs beside the way in, a wall's gap apart */
    const off = w + 2 * WALL_T + 40;
    const z0 = THICK;
    const t: Track = {
      width: w,
      track: colourIn(v, "track"),
      walls: wallsIn(v, "walls", colourIn(v, "wallc")),
    };
    /* round the loop the surface faces its middle, drifting sideways smoothly by `off` */
    const ring: Array<Stop> = Array.from({ length: n + 1 }, (_, i) => {
      const s = i / n;
      const a = s * Math.PI * 2;
      const y = off * (s - Math.sin(a) / (Math.PI * 2));
      const p: V3 = [R * Math.sin(a), y, z0 + R * (1 - Math.cos(a))];
      return { p, up: norm(sub([0, y, z0 + R], p)) };
    });
    const chord = 2 * R * Math.sin(Math.PI / n);
    return fileOf(
      grounded([
        ...(lead > 0 ? trackOf(straight([-lead, 0, z0], [0, 0, z0]), t) : []),
        ...trackOf(ring, t, () => (chord * (THICK + WALL)) / (2 * R) + 3),
        ...(lead > 0 ? trackOf(straight([0, off, z0], [lead, off, z0]), t) : []),
      ]),
    );
  },
};

/* ---------- jump ---------- */
export const jump: Generator = {
  key: "jump",
  name: "Jump",
  category: "Racing",
  blurb: "A run-up, a curved kicker, a gap and a landing that slopes away, up on legs.",
  file: "jump",
  angle: { from: [-0.3, 0.9, 0.3], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    gap: 6,
    kick: 25,
    drop: 1.5,
    width: 3,
    runup: 8,
    landing: 12,
    walls: true,
    legs: true,
    track: "Orange",
    wallc: "White",
    legc: "Dark",
  },
  controls: (v) => [
    num("gap", "Gap", 1, 30, 0.5, "m"),
    num("kick", "Kicker angle", 5, 45, 1, "°"),
    num("drop", "Landing lower by", 0, 15, 0.5, "m"),
    num("width", "Track width", 1, 8, 0.5, "m"),
    { key: "walls", label: "Walls", kind: "toggle" },
    { key: "legs", label: "Legs under it", kind: "toggle" },
    num("runup", "Run-up", 2, 30, 0.5, "m", true),
    num("landing", "Landing length", 3, 40, 0.5, "m", true),
    colour("track", "Track"),
    ...(v.walls ? [colour("wallc", "Walls")] : []),
    ...(v.legs ? [colour("legc", "Legs")] : []),
  ],
  build: (v) => {
    const w = metresIn(v, "width");
    const kick = (numberIn(v, "kick") * Math.PI) / 180;
    const runup = metresIn(v, "runup");
    const landing = metresIn(v, "landing");
    /* the kicker is an arc 4 m long, in six pieces, curving up from flat to the kick */
    const rk = 400 / kick;
    const K = 6;
    const arc: Array<Stop> = Array.from({ length: K + 1 }, (_, i) => {
      const a = (i / K) * kick;
      return {
        p: [rk * Math.sin(a), 0, rk * (1 - Math.cos(a))],
        up: [-Math.sin(a), 0, Math.cos(a)],
      };
    });
    const lip = arc[K].p;
    /* the landing slopes down at half the kick (5° to 25°) for half its length, then runs flat */
    const fall = Math.min(25, Math.max(5, (kick * 90) / Math.PI)) * (Math.PI / 180);
    const l0: V3 = [lip[0] + metresIn(v, "gap"), 0, lip[2] - metresIn(v, "drop")];
    const l1: V3 = add(l0, [(landing / 2) * Math.cos(fall), 0, (-landing / 2) * Math.sin(fall)]);
    const l2: V3 = add(l1, [landing / 2, 0, 0]);
    /* raised so the lowest of it sits a metre up, off the floor */
    const lift = 100 + THICK - Math.min(0, l2[2]);
    const up = (s: Array<Stop>) => s.map((x) => ({ ...x, p: add(x.p, [0, 0, lift]) }));
    const t: Track = {
      width: w,
      track: colourIn(v, "track"),
      walls: wallsIn(v, "walls", colourIn(v, "wallc")),
    };
    const landUp: V3 = [Math.sin(fall), 0, Math.cos(fall)];
    const items = [
      ...trackOf(up(straight([-runup, 0, 0], [0, 0, 0])), t),
      ...trackOf(up(arc), t, () => 4),
      ...trackOf(
        up([
          { p: l0, up: landUp },
          { p: l1, up: landUp },
        ]),
        t,
      ),
      ...trackOf(up(straight(l1, l2)), t, () => 10),
    ];
    if (v.legs) {
      /* a pair of legs at least every 4 m under each straight run, and under the kicker's lip */
      const under = (a: V3, b: V3) => {
        const n = Math.max(1, Math.ceil(Math.hypot(...sub(b, a)) / 400));
        return Array.from({ length: n + 1 }, (_, i) => add(a, mul(sub(b, a), i / n)));
      };
      const feet = [
        ...under([-runup + 30, 0, 0], [0, 0, 0]),
        [lip[0] - 30, 0, lip[2] - 10] as V3,
        ...under(add(l0, [30, 0, -10]), l1),
        ...under(l1, add(l2, [-30, 0, 0])),
      ];
      for (const f of feet)
        for (const s of [-1, 1]) {
          const h = f[2] + lift - THICK;
          if (h > 5)
            items.push(
              piece("cylinder", [f[0], s * (w / 2 - 25), 0], [40, 40, h], colourIn(v, "legc")),
            );
        }
    }
    return fileOf(items);
  },
};

/* ---------- plinko ---------- */
export const plinko: Generator = {
  key: "plinko",
  name: "Plinko board",
  category: "Racing",
  blurb: "A sloping board full of pegs in staggered rows, with slots to land in at the bottom.",
  file: "plinko",
  angle: { from: [-0.8, 0.3, 0.55], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    width: 6,
    length: 10,
    slope: 35,
    spacing: 1.2,
    peg: 0.25,
    slots: true,
    sides: true,
    board: "White",
    pegc: "Red",
    sidec: "Dark",
  },
  controls: (v) => [
    num("width", "Width", 2, 20, 0.5, "m"),
    num("length", "Length", 3, 30, 0.5, "m"),
    num("slope", "Slope", 10, 70, 1, "°"),
    num("spacing", "Peg spacing", 0.6, 4, 0.1, "m"),
    { key: "slots", label: "Slots at the bottom", kind: "toggle" },
    { key: "sides", label: "Sides", kind: "toggle" },
    num("peg", "Peg width", 0.1, 1, 0.05, "m", true),
    colour("board", "Board"),
    colour("pegc", "Pegs"),
    ...(v.slots || v.sides ? [colour("sidec", "Sides and slots")] : []),
  ],
  build: (v) => {
    const W = metresIn(v, "width");
    const L = metresIn(v, "length");
    const S = numberIn(v, "slope");
    const s = metresIn(v, "spacing");
    const d = Math.min(metresIn(v, "peg"), s * 0.6);
    const ph = Math.max(40, s * 0.5);
    const rad = (S * Math.PI) / 180;
    /* it falls toward the camera (-X): along it is up the slope, its face square to that */
    const along: V3 = [Math.cos(rad), 0, Math.sin(rad)];
    const face: V3 = [-Math.sin(rad), 0, Math.cos(rad)];
    const rot: V3 = [S, 0, 0];
    const centre: V3 = [0, 0, (L / 2) * Math.sin(rad) + (THICK / 2) * Math.cos(rad) + 50];
    /* the board's surface `u` up the slope from its middle and `y` across */
    const at = (u: number, y: number) =>
      add(add(centre, mul(along, u)), add([0, y, 0], mul(face, THICK / 2)));
    const sidec = colourIn(v, "sidec");
    const items: Array<PrefabItem> = [boxAt(centre, [L, W, THICK], colourIn(v, "board"), rot)];
    const slotLen = v.slots ? Math.min(200, L * 0.2) : 0;
    const row = s * Math.sqrt(3) * 0.5;
    for (let j = 0; ; j++) {
      const u = L / 2 - s * 0.75 - j * row;
      if (u < -L / 2 + slotLen + s * 0.5) break;
      /* every other row shifted half a spacing, so a ball can't fall straight through */
      const cols = Math.floor(W / s) + 1;
      for (let i = 0; i < cols; i++) {
        const y = (i - (cols - 1) / 2) * s + (j % 2 ? s / 2 : 0);
        if (Math.abs(y) + d / 2 > W / 2 - (v.sides ? WALL_T : 0)) continue;
        items.push(piece("cylinder", at(u, y), [d, d, ph], colourIn(v, "pegc"), rot));
      }
    }
    if (v.slots) {
      for (let y = -W / 2 + s; y < W / 2 - s / 2; y += s)
        items.push(
          boxAt(add(at(-L / 2 + slotLen / 2, y), mul(face, ph / 2)), [slotLen, 10, ph], sidec, rot),
        );
      items.push(
        boxAt(add(at(-L / 2 + WALL_T / 2, 0), mul(face, ph / 2)), [WALL_T, W, ph], sidec, rot),
      );
    }
    if (v.sides)
      for (const e of [-1, 1])
        items.push(
          boxAt(
            add(at(0, e * (W / 2 - WALL_T / 2)), mul(face, ph / 2)),
            [L, WALL_T, ph],
            sidec,
            rot,
          ),
        );
    /* two legs hold up the top end */
    const high = add(add(centre, mul(along, L / 2 - 30)), mul(face, -THICK / 2));
    for (const e of [-1, 1])
      items.push(boxAt([high[0], e * (W / 2 - 25), high[2] / 2], [30, 30, high[2]], sidec));
    return fileOf(items);
  },
};

/* ---------- rollers ---------- */
export const rollers: Generator = {
  key: "rollers",
  name: "Rollers",
  category: "Racing",
  blurb: "A straight track over a row of smooth bumps.",
  file: "rollers",
  angle: { from: [-0.3, 0.9, 0.3], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    length: 20,
    bumps: 4,
    height: 1.2,
    width: 3,
    steps: 10,
    walls: true,
    track: "Lime",
    wallc: "Dark",
  },
  controls: (v) => [
    num("length", "Length", 5, 80, 1, "m"),
    num("bumps", "Bumps", 1, 20, 1),
    num("height", "Bump height", 0.2, 5, 0.1, "m"),
    num("width", "Track width", 1, 8, 0.5, "m"),
    { key: "walls", label: "Walls", kind: "toggle" },
    num("steps", "Pieces a bump", 4, 24, 1, undefined, true),
    colour("track", "Track"),
    ...(v.walls ? [colour("wallc", "Walls")] : []),
  ],
  build: (v) => {
    const L = metresIn(v, "length");
    const k = numberIn(v, "bumps");
    /* bumps no steeper than 45°: a cosine's steepest slope is its height times π over its length */
    const A = Math.min(metresIn(v, "height"), L / (Math.PI * k));
    const n = k * numberIn(v, "steps");
    const z = (x: number) => THICK + (A * (1 - Math.cos((Math.PI * 2 * k * x) / L))) / 2;
    const slope = (x: number) => ((A * Math.PI * k) / L) * Math.sin((Math.PI * 2 * k * x) / L);
    const stops: Array<Stop> = Array.from({ length: n + 1 }, (_, i) => {
      const x = (i / n) * L;
      return { p: [x - L / 2, 0, z(x)], up: norm([-slope(x), 0, 1]) };
    });
    return fileOf(
      grounded(
        trackOf(
          stops,
          {
            width: metresIn(v, "width"),
            track: colourIn(v, "track"),
            walls: wallsIn(v, "walls", colourIn(v, "wallc")),
          },
          /* only a little longer: over a crest a longer piece would stand proud of the next */
          () => 3,
        ),
      ),
    );
  },
};
