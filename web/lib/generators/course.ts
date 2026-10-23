// The Full course (lib/generators/racing.ts): every Racing piece laid end to end as one Prefab,
// from a start up on legs down to a finish on the floor. It falls and climbs, turns both ways,
// and splits at a T junction into two ways (one flat, one over rollers) that meet again at a
// second. No checkpoints: a player adds their own.
import {
  DEG,
  colour,
  colourIn,
  fileOf,
  num,
  numberIn,
  type Colour,
  type Generator,
  type Values,
} from "./pieces";
import { trackIn } from "./racing";
import {
  START,
  bend,
  chain,
  itemsOf,
  jump,
  loop,
  setDown,
  placed,
  rollers,
  sBend,
  spiral,
  straight,
  supportsOf,
  tee,
  together,
  type Section,
  type Track,
} from "./track";

/* to the right is toward +Y (lib/generators/track.ts, Frame) */
const RIGHT = Math.PI / 2;
const LEFT = -Math.PI / 2;

interface Fork {
  arm: number;
  stem: number;
  radius: number;
  /* the length of each way's middle stretch, one flat, the other over rollers */
  middle: number;
  /* how far each way climbs over its two corners (falls below 0) */
  rise: number;
  post: Colour;
}
/* a T junction splitting the track right and left, each way turning back to run ahead, then
   in again to a second T that joins them and carries on the way the first came in */
function fork(t: Track, flat: Track, bumpy: Track, f: Fork, steps: number): Section {
  const split = tee(t, { arm: f.arm, stem: f.stem, post: f.post });
  const way = (out: number, middle: Section, tw: Track) =>
    chain(split.exits[out === RIGHT ? 0 : 1], [
      bend(tw, { radius: f.radius, angle: -out, rise: f.rise / 2, ease: true, steps }),
      middle,
      bend(tw, { radius: f.radius, angle: -out, rise: f.rise / 2, ease: true, steps }),
    ]);
  const right = way(RIGHT, straight(flat, f.middle), flat);
  const left = way(LEFT, rollers(bumpy, f.middle, 2, 40), bumpy);
  /* the second T, turned round: its arms take the two ways in, its stem leads on */
  const crossing = right.exits[0].p;
  const out = {
    p: [crossing[0] + f.stem + t.width / 2, 0, crossing[2]] as typeof crossing,
    yaw: 0,
  };
  const join = placed(tee(t, { arm: f.arm, stem: f.stem }), { ...out, yaw: Math.PI });
  return { ...together([split, left, right, join]), exits: [out] };
}

/* the course, starting at the origin heading +X, before it is set on the floor: each piece in
   one of two colours by turns, so a player can tell where one ends */
export function course(t: Track, other: Track, post: Colour, column: Colour, steps: number) {
  const by = (i: number) => (i % 2 ? other : t);
  /* tuned with a ball model fitted to the top runs' ghosts and driven round the course: each
     bend banked and wide enough to take at the speed the ball arrives, the rollers and crests
     gentle enough to keep it on the track, the jump's gap sized for its speed off the kicker, and
     the finish run falling a little so it stays the lowest stretch under the banked turns */
  const parts: Array<(t: Track) => Section> = [
    (u) => straight(u, 800),
    (u) => straight(u, 1500, -310),
    (u) => bend(u, { radius: 1280, angle: -Math.PI, rise: -90, bank: 45 * DEG, ease: true, steps }),
    (u) => rollers(u, 3760, 2, 40),
    (u) => bend(u, { radius: 1200, angle: RIGHT, rise: 20, bank: 45 * DEG, ease: true, steps }),
    (u) => jump(u, { runup: 200, kick: 12 * DEG, gap: 1500, drop: 50, landing: 800 }),
    (u) => straight(u, 1840, 140),
    (u) =>
      fork(u, other, t, { arm: 300, stem: 110, radius: 330, middle: 1600, rise: 60, post }, steps),
    (u) => bend(u, { radius: 400, angle: LEFT, steps }),
    (u) =>
      spiral(u, { radius: 500, turns: 1.5, drop: 790, bank: 45 * DEG, ease: true, steps, column }),
    (u) => straight(u, 860, -100),
    (u) => straight(u, 670),
    (u) => loop(u, 520, 32),
    (u) => sBend(u, 2660, 300, steps),
    (u) => bend(u, { radius: 2490, angle: RIGHT, bank: 45 * DEG, ease: true, steps }),
    /* the run to the finish passes under the first banked turn */
    (u) => straight(u, 9220, -150),
  ];
  return chain(
    START,
    parts.map((p, i) => p(by(i))),
  );
}

/* the course these values make, set down so its lowest stretch lies on the floor, as any piece
   on the floor would */
export function courseIn(v: Values): Section {
  const c = course(
    trackIn(v),
    trackIn(v, "other"),
    colourIn(v, "postc"),
    colourIn(v, "legc"),
    numberIn(v, "steps"),
  );
  return setDown(c);
}

export const fullCourse: Generator = {
  key: "course",
  name: "Full course",
  category: "Racing",
  blurb:
    "Every Racing piece in one course: ramps, banked turns, rollers, a jump, a split, a spiral and a loop.",
  file: "full_course",
  angle: { from: [-0.5, 0.75, 0.45], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    width: 3,
    walls: true,
    legs: true,
    steps: 32,
    track: "Sky blue",
    other: "White",
    wallc: "Dark",
    postc: "Red",
    legc: "Aluminum",
  },
  controls: (v) => [
    num("width", "Track width", 2, 5, 0.5, "m"),
    { key: "walls", label: "Walls", kind: "toggle" },
    { key: "legs", label: "Legs and column", kind: "toggle" },
    num("steps", "Pieces a turn", 16, 64, 1, undefined, true),
    colour("track", "Track"),
    colour("other", "Every other piece"),
    ...(v.walls ? [colour("wallc", "Walls")] : []),
    colour("postc", "Junction post"),
    ...(v.legs ? [colour("legc", "Legs")] : []),
  ],
  build: (v) => {
    const p = courseIn(v);
    return fileOf([...itemsOf(p), ...(v.legs ? supportsOf(p, colourIn(v, "legc")) : [])]);
  },
};
