// Track sections (lib/generators/track.ts) and the Full course they make: where each piece
// comes out, so pieces meet, and that the course never runs into itself or its own legs.
import { describe, expect, test } from "vitest";

import { courseIn } from "../lib/generators/course";
import { generate, generatorOf } from "../lib/generators";
import {
  START,
  bend,
  chain,
  placed,
  sBend,
  straight,
  tee,
  type Section,
  type Track,
} from "../lib/generators/track";

type V3 = [number, number, number];
const T: Track = { width: 300, track: "White", walls: "Dark" };
const DEG = Math.PI / 180;
/* the most two slabs' tops differ in height where they meet, at the track's edges, in cm: each
   slab is flat through its two stops, tipped to their average up, so its edge stands
   `side`·z × half the width off the centreline (where a slab is near level, not round a loop) */
function edgeStep(s: Section) {
  let most = 0;
  for (const r of s.runs) {
    const sides = r.stops.slice(1).map((x, i) => {
      const u = r.stops[i].up.map((c, k) => c + x.up[k]);
      const d = x.p.map((c, k) => c - r.stops[i].p[k]);
      const side = [
        u[1] * d[2] - u[2] * d[1],
        u[2] * d[0] - u[0] * d[2],
        u[0] * d[1] - u[1] * d[0],
      ];
      const level = u[2] / Math.hypot(...u) > 0.5;
      return { z: side[2] / Math.hypot(...side), level };
    });
    for (let i = 0; i + 1 < sides.length; i++)
      if (sides[i].level && sides[i + 1].level)
        most = Math.max(most, (Math.abs(sides[i].z - sides[i + 1].z) * r.t.width) / 2);
  }
  return most;
}
const near = (a: V3, b: V3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 3));

describe("the sections", () => {
  test("come out where their size says, on whole metres for whole-metre sizes", () => {
    const corner = bend(T, { radius: 600, angle: Math.PI / 2 }).exits[0];
    near(corner.p, [600, 600, 0]);
    expect(corner.yaw).toBeCloseTo(Math.PI / 2);
    const left = bend(T, { radius: 600, angle: -Math.PI / 2, rise: 100 }).exits[0];
    near(left.p, [600, -600, 100]);
    const s = sBend(T, 1200, -400).exits[0];
    near(s.p, [1200, -400, 0]);
    expect(s.yaw).toBeCloseTo(0);
    const [right, leftArm] = tee(T, { arm: 400, stem: 300 }).exits;
    near(right.p, [450, 400, 0]);
    near(leftArm.p, [450, -400, 0]);
  });

  test("an S-bend too tight for its track keeps its length and shifts less", () => {
    const wide: Track = { ...T, width: 800 };
    const out = sBend(wide, 400, 400).exits[0];
    expect(out.p[0]).toBeCloseTo(400, 3);
    expect(out.p[1]).toBeGreaterThan(0);
    expect(out.p[1]).toBeLessThan(400);
    expect(out.yaw).toBeCloseTo(0);
  });

  test("a rising bend tips back as it climbs, as a straight does", () => {
    const stops = bend(T, { radius: 600, angle: Math.PI / 2, rise: 400, ease: true }).runs[0].stops;
    const mid = stops[Math.floor(stops.length / 2)];
    const ahead = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)];
    expect(mid.up[0] * ahead[0] + mid.up[1] * ahead[1]).toBeLessThan(-0.3);
  });

  test("a banked turn twists in a little a piece, so the slabs' edges meet", () => {
    for (const bank of [10, 45, 60]) {
      const b = bend(T, {
        radius: 800,
        angle: Math.PI / 2,
        bank: bank * DEG,
        ease: true,
        steps: 32,
      });
      expect(edgeStep(b), `${bank}°`).toBeLessThan(8);
    }
  });

  test("a banked turn eases out as it eased in, stop for stop", () => {
    const R = 800;
    const { stops } = bend(T, { radius: R, angle: Math.PI / 2, bank: 45 * DEG, ease: true })
      .runs[0];
    const round = (i: number) => Math.atan2(stops[i].p[0], R - stops[i].p[1]);
    for (let i = 0; i < stops.length; i++)
      expect(round(i) + round(stops.length - 1 - i)).toBeCloseTo(Math.PI / 2, 6);
  });

  test("one after another start each where the last came out", () => {
    const c = chain(START, [straight(T, 1000, -200), bend(T, { radius: 500, angle: Math.PI })]);
    const [a, b] = c.runs;
    near(a.stops[a.stops.length - 1].p, b.stops[0].p);
    near(c.exits[0].p, [1000, 1000, -200]);
    expect(c.exits[0].yaw).toBeCloseTo(Math.PI);
  });

  test("turn and move with where they're placed", () => {
    const s = placed(straight(T, 1000), { p: [100, 200, 300], yaw: Math.PI / 2 });
    near(s.exits[0].p, [100, 1200, 300]);
  });
});

/* the centreline every 50 cm, each point with its run */
function samples(s: Section) {
  const out: Array<{ p: V3; run: number; end: boolean }> = [];
  s.runs.forEach((r, run) => {
    for (let i = 0; i + 1 < r.stops.length; i++) {
      const a = r.stops[i].p;
      const b = r.stops[i + 1].p;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 50));
      for (let j = i ? 1 : 0; j <= n; j++)
        out.push({
          p: a.map((x, k) => x + ((b[k] - x) * j) / n) as V3,
          run,
          end: (i === 0 && j === 0) || (i + 2 === r.stops.length && j === n),
        });
    }
  });
  return out;
}
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const flat = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("the Full course", () => {
  const defaults = generatorOf("course")?.defaults ?? {};
  const c = courseIn(defaults);
  const pts = samples(c);

  test("starts at its highest and comes down to finish at its lowest", () => {
    const zs = pts.map((x) => x.p[2]);
    expect(Math.max(...zs)).toBeCloseTo(c.runs[0].stops[0].p[2]);
    expect(c.exits[0].p[2]).toBeCloseTo(Math.min(...zs), 0);
    expect(Math.min(...zs)).toBeLessThan(100);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1000);
  });

  test("climbs somewhere on its way down, and turns both ways", () => {
    const climbs = c.runs.some(
      (r) => r.stops.length > 4 && r.stops[r.stops.length - 1].p[2] - r.stops[0].p[2] > 100,
    );
    expect(climbs).toBe(true);
    const turns = c.runs.flatMap((r) =>
      r.stops.slice(2).map((x, i) => {
        const [a, b] = [r.stops[i].p, r.stops[i + 1].p];
        const [u, v] = [
          [b[0] - a[0], b[1] - a[1]],
          [x.p[0] - b[0], x.p[1] - b[1]],
        ];
        return u[0] * v[1] - u[1] * v[0];
      }),
    );
    expect(turns.some((t) => t > 1000)).toBe(true);
    expect(turns.some((t) => t < -1000)).toBe(true);
  });

  test("never passes over or beside itself closer than 2.5 m but where it runs on", () => {
    /* how far along the track each point is from every other: along each run, and across from
       a run's end to whatever it touches (the next run, or a junction's crossing) */
    const n = pts.length;
    const edges: Array<Array<[number, number]>> = pts.map(() => []);
    const link = (i: number, j: number, w: number) => {
      edges[i].push([j, w]);
      edges[j].push([i, w]);
    };
    for (let i = 0; i + 1 < n; i++)
      if (pts[i].run === pts[i + 1].run) link(i, i + 1, dist(pts[i].p, pts[i + 1].p));
    for (let i = 0; i < n; i++)
      if (pts[i].end)
        for (let j = 0; j < n; j++)
          if (pts[j].run !== pts[i].run && dist(pts[i].p, pts[j].p) <= T.width / 2 + 10)
            link(i, j, dist(pts[i].p, pts[j].p));
    const along = (from: number) => {
      const d = new Float64Array(n).fill(Infinity);
      d[from] = 0;
      const todo = new Set([from]);
      while (todo.size) {
        let i = -1;
        for (const k of todo) if (i < 0 || d[k] < d[i]) i = k;
        todo.delete(i);
        if (d[i] > 3000) continue;
        for (const [j, w] of edges[i])
          if (d[i] + w < d[j]) {
            d[j] = d[i] + w;
            todo.add(j);
          }
      }
      return d;
    };
    const clashes: Array<string> = [];
    for (let i = 0; i < n; i++) {
      const close = pts
        .map((q, j) => j)
        .filter(
          (j) =>
            j > i &&
            flat(pts[i].p, pts[j].p) < T.width + 40 &&
            Math.abs(pts[i].p[2] - pts[j].p[2]) < 250,
        );
      if (!close.length) continue;
      const d = along(i);
      for (const j of close)
        if (d[j] > dist(pts[i].p, pts[j].p) * 2 + T.width)
          clashes.push(
            `${pts[i].p.map(Math.round).join(",")} ~ ${pts[j].p.map(Math.round).join(",")}`,
          );
    }
    expect(clashes.slice(0, 5)).toEqual([]);
  });

  test("has no step over 8 cm where one slab meets the next", () => {
    expect(edgeStep(c)).toBeLessThan(8);
  });

  test("has no leg or column standing where track runs underneath its top", () => {
    const legs = (generate("course", defaults)?.items ?? []).filter((it) =>
      it.class.includes("Cylinder"),
    );
    expect(legs.length).toBeGreaterThan(20);
    const stuck = legs.filter((leg) => {
      const [x, y] = leg.transform.location;
      /* a cylinder is 1000 cm across and 200 tall at scale 1 */
      const top = leg.transform.scale[2] * 200;
      const r = (leg.transform.scale[0] * 1000) / 2;
      return pts.some((q) => q.p[2] < top - 30 && flat(q.p, [x, y, 0]) < r + T.width / 2 + 10);
    });
    expect(stuck.map((it) => it.transform.location.map(Math.round))).toEqual([]);
  });
});
