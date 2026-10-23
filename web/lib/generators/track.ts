// Track sections (lib/generators/racing.ts): each course piece as the runs of stops its slabs
// lie along, built where it starts, heading +X with its surface at z = 0, with the frames it can
// be left by. A piece's Generator places one section; the Full course places one after another,
// each starting at the last one's way out, so every piece that shares a width meets the next.
import type { PrefabItem } from "../prefab";
import {
  DEG,
  add,
  cross,
  lowestOf,
  mul,
  norm,
  piece,
  slab,
  sub,
  type Colour,
  type V3,
} from "./pieces";

/* a track slab's depth, and its walls' height and thickness, in cm */
export const THICK = 30;
export const WALL = 60;
export const WALL_T = 15;
/* legs: how thick, and the most track between two pairs of them */
const LEG = 40;
const LEG_EVERY = 400;

/* a point on a track's centreline, its surface facing `up` */
export interface Stop {
  p: V3;
  up: V3;
}
export interface Track {
  width: number;
  track: Colour;
  /* none: no walls */
  walls?: Colour;
}
/* where a section starts, or a way out of one: a point on the surface and the heading, in
   radians from +X toward +Y. Unreal's axes are left-handed: the editor's camera looks along +X
   with +Y on its right, so a heading growing from 0 turns right */
export interface Frame {
  p: V3;
  yaw: number;
}
/* a chain of slabs, each `over` cm longer at each end (a bend's outer edge needs it) */
interface Run {
  stops: Array<Stop>;
  t: Track;
  over: number;
  /* walls along both sides (a junction builds its own round its openings) */
  walls: boolean;
  /* legs can stand under it (not a spiral, which has its column) */
  legs: boolean;
}
/* a column from the floor up to `top`, `d` across */
interface Pillar {
  top: V3;
  d: number;
  c: Colour;
}
export interface Section {
  runs: Array<Run>;
  /* the pieces that aren't track: a junction's walls and post */
  extras: Array<PrefabItem>;
  /* the columns that stand on the floor, wherever that turns out to be: a spiral's middle */
  pillars?: Array<Pillar>;
  /* the ways out, the first the one a course carries on along */
  exits: Array<Frame>;
}
const run = (stops: Array<Stop>, t: Track, over = 2): Run => ({
  stops,
  t,
  over,
  walls: true,
  legs: true,
});
const UP: V3 = [0, 0, 1];
export const START: Frame = { p: [0, 0, 0], yaw: 0 };

/* ---------- placing ---------- */
const turned = (v: V3, yaw: number): V3 => [
  v[0] * Math.cos(yaw) - v[1] * Math.sin(yaw),
  v[0] * Math.sin(yaw) + v[1] * Math.cos(yaw),
  v[2],
];
/* a point of a section placed at f */
const at = (f: Frame, v: V3): V3 => add(f.p, turned(v, f.yaw));
/* a piece turned about the vertical: an Unreal rotator turns by yaw last, so the yaw adds */
function moved(it: PrefabItem, f: Frame): PrefabItem {
  const [pitch, yaw, roll] = it.transform.rotation;
  return {
    ...it,
    transform: {
      ...it.transform,
      location: at(f, it.transform.location),
      rotation: [pitch, yaw + f.yaw / DEG, roll],
    },
  };
}
/* the section moved to start at f */
export function placed(s: Section, f: Frame): Section {
  return {
    runs: s.runs.map((r) => ({
      ...r,
      stops: r.stops.map((x) => ({ p: at(f, x.p), up: turned(x.up, f.yaw) })),
    })),
    extras: s.extras.map((it) => moved(it, f)),
    pillars: s.pillars?.map((x) => ({ ...x, top: at(f, x.top) })),
    exits: s.exits.map((e) => ({ p: at(f, e.p), yaw: e.yaw + f.yaw })),
  };
}
/* sections one after another, each from the last one's first way out; the whole ends where the
   last one does */
export function chain(from: Frame, parts: Array<Section>): Section {
  let exits = [from];
  const done: Array<Section> = [];
  for (const s of parts) {
    const p = placed(s, exits[0]);
    done.push(p);
    exits = p.exits;
  }
  return { ...together(done), exits };
}
/* sections laid side by side, the first one's ways out the whole's */
export const together = (parts: Array<Section>): Section => ({
  runs: parts.flatMap((s) => s.runs),
  extras: parts.flatMap((s) => s.extras),
  pillars: parts.flatMap((s) => s.pillars ?? []),
  exits: parts[0]?.exits ?? [],
});

/* ---------- pieces ---------- */
/* the slabs along a run of stops, and with walls each side's wall standing on the slab's edge */
function slabsOf(r: Run): Array<PrefabItem> {
  const items: Array<PrefabItem> = [];
  for (let i = 0; i + 1 < r.stops.length; i++) {
    const a = r.stops[i].p;
    const b = r.stops[i + 1].p;
    const up = norm(add(r.stops[i].up, r.stops[i + 1].up));
    items.push(slab(a, b, up, r.t.width, THICK, r.t.track, r.over));
    if (!r.walls || !r.t.walls) continue;
    const side = norm(cross(up, sub(b, a)));
    for (const s of [-1, 1]) {
      const shift = add(mul(side, s * (r.t.width / 2 + WALL_T / 2)), mul(up, WALL));
      items.push(
        slab(add(a, shift), add(b, shift), up, WALL_T, WALL + THICK, r.t.walls, r.over + WALL_T),
      );
    }
  }
  return items;
}
export const itemsOf = (s: Section) => [...s.runs.flatMap(slabsOf), ...s.extras];

/* the centreline every 50 cm, to tell what lies under a leg: each point, its run and how far
   along it */
function samplesOf(runs: Array<Run>) {
  const out: Array<{ p: V3; run: Run; along: number }> = [];
  for (const r of runs) {
    let along = 0;
    for (let i = 0; i + 1 < r.stops.length; i++) {
      const a = r.stops[i].p;
      const d = sub(r.stops[i + 1].p, a);
      const len = Math.hypot(...d);
      const n = Math.max(1, Math.ceil(len / 50));
      for (let j = 0; j <= n; j++)
        out.push({ p: add(a, mul(d, j / n)), run: r, along: along + (len * j) / n });
      along += len;
    }
  }
  return out;
}
/* along its own run, the track this near a leg and in the plane of the slab over it is the
   stretch it holds up, sloping or banked past it, not track underneath */
const OWN = 1000;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* what holds a section up off the floor (z = 0): its pillars, and pairs of legs to the slabs'
   undersides, one pair near each end of a run and at least every 4 m between, wherever the
   surface is within 60° of level (not round a loop's top) and no other track runs underneath */
export function supportsOf(s: Section, c: Colour): Array<PrefabItem> {
  const under = samplesOf(s.runs);
  const feet: Array<V3> = [];
  const legs: Array<PrefabItem> = (s.pillars ?? []).map((x) =>
    piece("cylinder", [x.top[0], x.top[1], 0], [x.d, x.d, x.top[2]], x.c),
  );
  for (const r of s.runs) {
    if (!r.legs) continue;
    const lens = r.stops.slice(1).map((x, i) => Math.hypot(...sub(x.p, r.stops[i].p)));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 1) continue;
    const inset = Math.min(30, total / 2);
    const n = Math.max(1, Math.ceil((total - 2 * inset) / LEG_EVERY));
    for (let k = 0; k <= n; k++) {
      /* the stop pair this far along, and how far between them */
      const along = inset + ((total - 2 * inset) * k) / n;
      let d = along;
      let i = 0;
      while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
      const a = r.stops[i];
      const b = r.stops[i + 1];
      const f = Math.min(1, d / lens[i]);
      const p = add(a.p, mul(sub(b.p, a.p), f));
      const up = norm(add(mul(a.up, 1 - f), mul(b.up, f)));
      if (up[2] < 0.5) continue;
      const side = norm(cross(up, sub(b.p, a.p)));
      for (const e of [-1, 1]) {
        const edge = add(p, mul(side, e * (r.t.width / 2 - LEG / 2 - 5)));
        /* under the slab's underside, short of it by as much as the slab tips across the leg */
        const tilt = Math.sqrt(1 - up[2] * up[2]) / up[2];
        const top = edge[2] - THICK / up[2] - (LEG / 2) * tilt;
        const clear = under.every(
          (q) =>
            (q.run === r &&
              Math.abs(q.along - along) < OWN &&
              Math.abs(dot(sub(q.p, p), up)) < THICK + WALL) ||
            q.p[2] > top - 20 ||
            Math.hypot(q.p[0] - edge[0], q.p[1] - edge[1]) > r.t.width / 2 + WALL_T + LEG,
        );
        /* where two runs meet, their end legs would stand in one another */
        const apart = feet.every((g) => Math.hypot(g[0] - edge[0], g[1] - edge[1]) > LEG * 2);
        if (top < 20 || !clear || !apart) continue;
        feet.push(edge);
        legs.push(piece("cylinder", [edge[0], edge[1], 0], [LEG, LEG, top], c));
      }
    }
  }
  return legs;
}

/* the lowest centreline stop and the lowest piece, so a section can be set on the floor */
const lowStop = (s: Section) => Math.min(...s.runs.flatMap((r) => r.stops.map((x) => x.p[2])));
const lowPiece = (s: Section) => lowestOf(itemsOf(s));

/* the section moved up or down so its lowest stretch of track is `raised` cm off the floor (none
   of it below the floor when that is 0), and `x` along */
export function setDown(s: Section, raised = 0, x = 0): Section {
  const low = Math.min(lowStop(s) - THICK, raised > 0 ? Infinity : lowPiece(s));
  return placed(s, { ...START, p: [x, 0, raised - low] });
}

/* ---------- sections ---------- */
/* a straight `length` long, rising by `rise` (falling when it's below 0) along a smooth S, flat
   at both ends so it meets a flat piece without a kink */
export function straight(t: Track, length: number, rise = 0, n = 8): Section {
  /* two slabs even when flat: the game spawns nothing from a Prefab of one piece */
  const steps = rise === 0 ? 2 : n;
  const stops: Array<Stop> = Array.from({ length: steps + 1 }, (_, i) => {
    const x = (i / steps) * length;
    const slope = ((rise * Math.PI) / (2 * length)) * Math.sin((Math.PI * x) / length);
    return {
      p: [x, 0, (rise * (1 - Math.cos((Math.PI * x) / length))) / 2],
      up: norm([-slope, 0, 1]),
    };
  });
  return {
    runs: [run(stops, t, rise === 0 ? 2 : 3)],
    extras: [],
    exits: [{ p: [length, 0, rise], yaw: 0 }],
  };
}

/* the steepest a ramp of this length may rise, 45° at its middle */
export const mostRise = (length: number) => (2 * length) / Math.PI;

export interface Bend {
  radius: number;
  /* radians, to the right (toward +Y) above 0 and to the left below; past a whole turn it winds */
  angle: number;
  rise?: number;
  /* radians, the surface tipped toward the middle of the bend */
  bank?: number;
  /* bank from flat at either end, full through its middle third, and rise along a smooth S,
     to meet flat pieces without a kink */
  ease?: boolean;
  /* pieces a whole turn */
  steps?: number;
}
/* a bend's centreline radius, at least far enough out that its inner edge clears the middle */
export const bendRadius = (width: number, radius: number) => Math.max(radius, width / 2 + 50);
/* a bend round a circle `radius` out to its centreline, rising evenly as it goes (or eased) */
export function bend(t: Track, b: Bend): Section {
  const R = bendRadius(t.width, b.radius);
  const s = Math.sign(b.angle) || 1;
  const A = Math.abs(b.angle);
  const rise = b.rise ?? 0;
  const n = Math.max(2, Math.ceil((A / (Math.PI * 2)) * (b.steps ?? 24)));
  const step = A / n;
  const stops: Array<Stop> = Array.from({ length: n + 1 }, (_, i) => {
    const a = i * step;
    const inward: V3 = [-Math.sin(a), s * Math.cos(a), 0];
    const ramp = b.ease ? Math.min(1, 3 * Math.min(i / n, 1 - i / n)) : 1;
    const k = (b.bank ?? 0) * ramp;
    /* the rise's slope here, so the surface also tips back as it climbs, as a Straight's does */
    const slope = b.ease
      ? ((rise * Math.PI) / (2 * R * A)) * Math.sin((Math.PI * i) / n)
      : rise / (R * A);
    const ahead: V3 = [Math.cos(a), s * Math.sin(a), 0];
    return {
      p: [
        R * Math.sin(a),
        s * R * (1 - Math.cos(a)),
        b.ease ? (rise * (1 - Math.cos((Math.PI * i) / n))) / 2 : (rise * i) / n,
      ],
      up: norm(add(add([0, 0, Math.cos(k)], mul(inward, Math.sin(k))), mul(ahead, -slope))),
    };
  });
  /* the outer edge's chord is longer than the centreline's by (R + w/2) / R */
  const chord = 2 * R * Math.sin(step / 2);
  const over = (chord * (t.width / 2 + WALL_T)) / (2 * R) + 5;
  return {
    runs: [run(stops, t, over)],
    extras: [],
    exits: [{ p: [R * Math.sin(A), s * R * (1 - Math.cos(A)), rise], yaw: s * A }],
  };
}

/* an S: a bend one way and the same bend back, `shift` to the right (left below 0) over
   `length`, so it comes out heading the way it went in; a shift that would bend tighter than the
   track's width allows shifts only as far as the tightest bend does */
export function sBend(t: Track, length: number, shift: number, steps = 24): Section {
  if (Math.abs(shift) < 1) return straight(t, length);
  const tight = bendRadius(t.width, 0);
  let angle = 2 * Math.atan(Math.abs(shift) / length);
  if (length / (2 * Math.sin(angle)) < tight) angle = Math.asin(Math.min(1, length / (2 * tight)));
  const radius = Math.max(tight, length / (2 * Math.sin(angle)));
  const s = Math.sign(shift);
  return chain(START, [
    bend(t, { radius, angle: s * angle, steps }),
    bend(t, { radius, angle: -s * angle, steps }),
  ]);
}

export interface Spiral {
  radius: number;
  turns: number;
  /* how far it falls each turn */
  drop: number;
  /* radians */
  bank: number;
  steps: number;
  /* a column up the middle to a wall's height over the top */
  column?: Colour;
  /* from flat and level at either end, to meet flat pieces */
  ease?: boolean;
}
/* a bend winding down to the right round and round, too tight for legs, so on its column */
export function spiral(t: Track, x: Spiral): Section {
  const s = bend(t, {
    radius: x.radius,
    angle: x.turns * Math.PI * 2,
    rise: -x.drop * x.turns,
    bank: x.bank,
    ease: x.ease,
    steps: x.steps,
  });
  const R = bendRadius(t.width, x.radius);
  const d = Math.max(40, 2 * (R - t.width / 2) - 60);
  return {
    ...s,
    runs: s.runs.map((r) => ({ ...r, legs: false })),
    pillars: x.column ? [{ top: [0, R, WALL], d, c: x.column }] : [],
  };
}

/* a loop-the-loop of radius R: once round, its surface facing the middle, drifting smoothly to
   the right so it comes out beside where it went in, a wall's gap over */
export function loop(t: Track, R: number, n = 32): Section {
  const off = t.width + 2 * WALL_T + 40;
  const ring: Array<Stop> = Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n;
    const a = s * Math.PI * 2;
    const y = off * (s - Math.sin(a) / (Math.PI * 2));
    const p: V3 = [R * Math.sin(a), y, R * (1 - Math.cos(a))];
    return { p, up: norm(sub([0, y, R], p)) };
  });
  const chord = 2 * R * Math.sin(Math.PI / n);
  return {
    runs: [run(ring, t, (chord * (THICK + WALL)) / (2 * R) + 3)],
    extras: [],
    exits: [{ p: [0, off, 0], yaw: 0 }],
  };
}

export interface Jump {
  runup: number;
  /* radians */
  kick: number;
  gap: number;
  drop: number;
  landing: number;
}
/* a run-up, a kicker curving up from flat to `kick` over 4 m in six pieces, a gap, and a landing
   that slopes down at half the kick (5° to 25°) for half its length, then runs flat */
export function jump(t: Track, j: Jump): Section {
  const rk = 400 / j.kick;
  const K = 6;
  const arc: Array<Stop> = Array.from({ length: K + 1 }, (_, i) => {
    const a = (i / K) * j.kick;
    return {
      p: [j.runup + rk * Math.sin(a), 0, rk * (1 - Math.cos(a))],
      up: [-Math.sin(a), 0, Math.cos(a)],
    };
  });
  const lip = arc[K].p;
  const fall = Math.min(25, Math.max(5, j.kick / DEG / 2)) * DEG;
  const l0: V3 = [lip[0] + j.gap, 0, lip[2] - j.drop];
  const l1: V3 = add(l0, [(j.landing / 2) * Math.cos(fall), 0, (-j.landing / 2) * Math.sin(fall)]);
  const l2: V3 = add(l1, [j.landing / 2, 0, 0]);
  const landUp: V3 = [Math.sin(fall), 0, Math.cos(fall)];
  return {
    runs: [
      run(
        [
          { p: [0, 0, 0], up: UP },
          { p: [j.runup, 0, 0], up: UP },
        ],
        t,
      ),
      run(arc, t, 4),
      run(
        [
          { p: l0, up: landUp },
          { p: l1, up: landUp },
        ],
        t,
      ),
      run(
        [
          { p: l1, up: UP },
          { p: l2, up: UP },
        ],
        t,
        10,
      ),
    ],
    extras: [],
    exits: [{ p: l2, yaw: 0 }],
  };
}

/* a straight `length` long over `bumps` smooth bumps, none steeper than 45° (a cosine's steepest
   slope is its height times π over its length), `steps` pieces a bump */
export function rollers(
  t: Track,
  length: number,
  bumps: number,
  height: number,
  steps = 10,
): Section {
  const A = Math.min(height, length / (Math.PI * bumps));
  const n = bumps * steps;
  const w = (Math.PI * 2 * bumps) / length;
  const stops: Array<Stop> = Array.from({ length: n + 1 }, (_, i) => {
    const x = (i / n) * length;
    const slope = ((A * Math.PI * bumps) / length) * Math.sin(w * x);
    return { p: [x, 0, (A * (1 - Math.cos(w * x))) / 2], up: norm([-slope, 0, 1]) };
  });
  /* only a little longer: over a crest a longer piece would stand proud of the next */
  return { runs: [run(stops, t, 3)], extras: [], exits: [{ p: [length, 0, 0], yaw: 0 }] };
}

export interface Tee {
  /* each arm's length from the middle of the crossing out to its end */
  arm: number;
  /* the stem's length up to the crossing */
  stem: number;
  /* a post where the stem meets the far wall, to send a ball left or right */
  post?: Colour;
}
/* a T: a stem from the start into the middle of a crossing track, its arms going off right and
   left (the first way out the right), a wall all along the far side and on the near side
   either side of the stem */
export function tee(t: Track, j: Tee): Section {
  const w = t.width;
  const mid = j.stem + w / 2;
  const arm = Math.max(j.arm, w / 2);
  const flat = (a: V3, b: V3): Run => ({
    ...run(
      [
        { p: a, up: UP },
        { p: b, up: UP },
      ],
      t,
    ),
    walls: false,
  });
  const runs = [
    ...(j.stem > 0 ? [flat([0, 0, 0], [j.stem, 0, 0])] : []),
    flat([mid, -arm, 0], [mid, arm, 0]),
  ];
  const extras: Array<PrefabItem> = [];
  const wall = (a: V3, b: V3) => {
    if (!t.walls || Math.hypot(...sub(b, a)) < 1) return;
    extras.push(
      slab(add(a, [0, 0, WALL]), add(b, [0, 0, WALL]), UP, WALL_T, WALL + THICK, t.walls),
    );
  };
  const far = mid + w / 2 + WALL_T / 2;
  const near = j.stem - WALL_T / 2;
  const side = w / 2 + WALL_T / 2;
  wall([far, -arm, 0], [far, arm, 0]);
  for (const e of [-1, 1]) {
    wall([near, e * (w / 2), 0], [near, e * arm, 0]);
    if (j.stem > WALL_T) wall([0, e * side, 0], [j.stem - WALL_T, e * side, 0]);
  }
  if (j.post) {
    const d = Math.min(100, w / 3);
    /* standing on the track against the far wall */
    extras.push(piece("cylinder", [mid + w / 2 - d / 2, 0, -THICK], [d, d, THICK + WALL], j.post));
  }
  return {
    runs,
    extras,
    exits: [
      { p: [mid, arm, 0], yaw: Math.PI / 2 },
      { p: [mid, -arm, 0], yaw: -Math.PI / 2 },
    ],
  };
}
