// The Full course (lib/generators/racing.ts): every Racing piece laid end to end as one Prefab,
// from a start up on legs down to a finish on the floor. It falls and climbs, turns both ways,
// and splits at a T junction into two ways (one flat, one over rollers) that meet again at a
// second. No checkpoints: a player adds their own.
import {
  DEG,
  colour,
  colourIn,
  fileOf,
  metresIn,
  num,
  numberIn,
  type Colour,
  type Generator,
  type Values,
} from "./pieces";
import {
  START,
  THICK,
  bend,
  chain,
  itemsOf,
  jump,
  loop,
  lowPiece,
  lowStop,
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

const LEFT = Math.PI / 2;
const RIGHT = -Math.PI / 2;

interface Fork {
  arm: number;
  stem: number;
  radius: number;
  /* the length of each way's middle stretch, one flat, the other over rollers */
  middle: number;
  /* how far each way falls over its two corners */
  fall: number;
  post: Colour;
}
/* a T junction splitting the track left and right, each way turning back to run ahead, then
   in again to a second T that joins them and carries on the way the first came in */
function fork(t: Track, flat: Track, bumpy: Track, f: Fork, steps: number): Section {
  const split = tee(t, { arm: f.arm, stem: f.stem, post: f.post });
  const way = (out: number, middle: Section, tw: Track) =>
    chain(split.exits[out === LEFT ? 0 : 1], [
      bend(tw, { radius: f.radius, angle: -out, rise: -f.fall / 2, steps }),
      middle,
      bend(tw, { radius: f.radius, angle: -out, rise: -f.fall / 2, steps }),
    ]);
  const left = way(LEFT, straight(flat, f.middle), flat);
  const right = way(RIGHT, rollers(bumpy, f.middle, 2, 80), bumpy);
  /* the second T, turned round: its arms take the two ways in, its stem leads on */
  const crossing = left.exits[0].p;
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
  const parts: Array<(t: Track) => Section> = [
    (u) => straight(u, 1000),
    (u) => straight(u, 1400, -400),
    (u) => bend(u, { radius: 800, angle: -Math.PI, rise: -100, bank: 30 * DEG, ease: true, steps }),
    (u) => rollers(u, 1800, 3, 100),
    (u) => bend(u, { radius: 600, angle: LEFT, rise: -50, steps }),
    (u) => jump(u, { runup: 400, kick: 20 * DEG, gap: 500, drop: 150, landing: 1000 }),
    (u) => straight(u, 1000, 150),
    (u) =>
      fork(u, other, t, { arm: 300, stem: 200, radius: 400, middle: 800, fall: 100, post }, steps),
    (u) => bend(u, { radius: 600, angle: RIGHT, steps }),
    (u) => spiral(u, { radius: 600, turns: 1.5, drop: 400, bank: 10 * DEG, steps, column }),
    (u) => straight(u, 1200, -200),
    (u) => straight(u, 600),
    (u) => loop(u, 400, 32),
    (u) => sBend(u, 1000, 400, steps),
    (u) => bend(u, { radius: 600, angle: LEFT, bank: 20 * DEG, ease: true, steps }),
    /* the run to the finish passes under the first banked turn */
    (u) => straight(u, 9200),
  ];
  return chain(
    START,
    parts.map((p, i) => p(by(i))),
  );
}

/* the course these values make, set down so its lowest stretch lies on the floor, as any piece
   on the floor would */
export function courseIn(v: Values): Section {
  const track = (k: string): Track => ({
    width: metresIn(v, "width"),
    track: colourIn(v, k),
    walls: v.walls ? colourIn(v, "wallc") : undefined,
  });
  const c = course(
    track("track"),
    track("other"),
    colourIn(v, "postc"),
    colourIn(v, "legc"),
    numberIn(v, "steps"),
  );
  const low = Math.min(lowStop(c) - THICK, lowPiece(c));
  return placed(c, { ...START, p: [0, 0, -low] });
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
