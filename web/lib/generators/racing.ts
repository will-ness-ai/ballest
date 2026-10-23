// Racing (lib/generators/index.ts): course pieces a ball rolls along, each a section of track
// (lib/generators/track.ts) whose slabs' tops make the surface, walls on either side if you
// like. A track starts on the camera's side and heads away from it (+X). The pieces share a
// width and their ends, so a Straight, Corner, Banked turn, S-bend or T junction meets the next
// wherever it's put, raised on legs to the same height; the Full course (course.ts) lays them
// all out as one.
import type { PrefabItem } from "../prefab";
import {
  boxAt,
  choice,
  colour,
  colourIn,
  fileOf,
  grounded,
  metresIn,
  mul,
  add,
  num,
  numberIn,
  piece,
  DEG,
  type Control,
  type Generator,
  type V3,
  type Values,
} from "./pieces";
import {
  THICK,
  WALL_T,
  START,
  bend,
  bendRadius,
  chain,
  itemsOf,
  jump as jumpSection,
  supportsOf,
  spiral as spiralSection,
  loop as loopSection,
  setDown,
  mostRise,
  placed,
  rollers as rollerSection,
  sBend,
  straight as straightSection,
  tee,
  type Section,
  type Track,
} from "./track";

/* the track these values ask for, its surface in the colour `key` names */
export const trackIn = (v: Values, key = "track"): Track => ({
  width: metresIn(v, "width"),
  track: colourIn(v, key),
  walls: v.walls ? colourIn(v, "wallc") : undefined,
});
const radiusIn = (v: Values) => bendRadius(metresIn(v, "width"), metresIn(v, "radius"));

/* a piece on its own, its lowest stretch of track `raised` up, and the legs under whatever is
   off the floor */
const raisedIn = (s: Section, v: Values) => setDown(s, metresIn(v, "raised"));
const legsOf = (p: Section, v: Values) => supportsOf(p, colourIn(v, "legc"));
function standing(s: Section, v: Values) {
  const p = raisedIn(s, v);
  return fileOf([...itemsOf(p), ...legsOf(p, v)]);
}
/* a piece that can be raised: the section `sectionOf` makes from the values, its own controls,
   then the ones every raised piece ends with (`extra` among them), the Legs colour only when
   the piece has legs, and the build */
const raisedPiece = (
  sectionOf: (v: Values) => Section,
  own: (v: Values) => Array<Control>,
  extra: (v: Values) => Array<Control> = () => [],
): Pick<Generator, "controls" | "build"> => ({
  controls: (v) => [
    ...own(v),
    num("width", "Track width", 1, 8, 0.5, "m"),
    num("raised", "Raised on legs", 0, 20, 0.5, "m"),
    { key: "walls", label: "Walls", kind: "toggle" },
    ...extra(v),
    colour("track", "Track"),
    ...(v.walls ? [colour("wallc", "Walls")] : []),
    ...(legsOf(raisedIn(sectionOf(v), v), v).length > 0 ? [colour("legc", "Legs")] : []),
  ],
  build: (v) => standing(sectionOf(v), v),
});
const RAISED = { width: 3, raised: 0, walls: true, wallc: "White", legc: "Dark" };
/* a rise either way up to `most` cm (no steeper than 45°), and the rise these values ask for
   kept within it */
const riseControl = (most: number, more = false) => {
  const m = Math.min(10, Math.floor(most / 50) / 2);
  return num("rise", "Rise (below 0 falls)", -m, m, 0.5, "m", more);
};
const riseIn = (v: Values, most: number) => Math.max(-most, Math.min(most, metresIn(v, "rise")));
/* a bend's centreline length, for the most it may rise (mostRise, as a Straight's) */
const bendLength = (v: Values) => radiusIn(v) * numberIn(v, "angle") * DEG;
/* a Corner, or with banking a Banked turn */
const bendIn = (v: Values, bank?: number) =>
  bend(trackIn(v), {
    radius: radiusIn(v),
    angle: (v.turn === "Left" ? -1 : 1) * numberIn(v, "angle") * DEG,
    rise: riseIn(v, mostRise(bendLength(v))),
    bank,
    ease: true,
    steps: numberIn(v, "steps"),
  });
const straightIn = (v: Values) => {
  const length = metresIn(v, "length");
  return straightSection(trackIn(v), length, riseIn(v, mostRise(length)));
};
const sBendIn = (v: Values) => {
  const length = metresIn(v, "length");
  const shift = Math.max(-length, Math.min(length, metresIn(v, "shift")));
  return sBend(trackIn(v), length, shift, numberIn(v, "steps"));
};
const teeIn = (v: Values) =>
  tee(trackIn(v), {
    arm: metresIn(v, "arm"),
    stem: metresIn(v, "stem"),
    post: v.post ? colourIn(v, "postc") : undefined,
  });

/* ---------- straight ---------- */
export const straight: Generator = {
  key: "straight",
  name: "Straight",
  category: "Racing",
  blurb: "A straight run of track, flat or rising and falling along a smooth ramp.",
  file: "straight",
  angle: { from: [-0.4, 0.85, 0.35], zoom: 1, pan: [0, 0, 0] },
  defaults: { ...RAISED, length: 10, rise: 0, track: "Sky blue" },
  ...raisedPiece(straightIn, (v) => [
    num("length", "Length", 2, 40, 1, "m"),
    riseControl(mostRise(metresIn(v, "length"))),
  ]),
};

/* ---------- corner ---------- */
export const corner: Generator = {
  key: "corner",
  name: "Corner",
  category: "Racing",
  blurb: "A flat turn left or right, rising or falling round it if you like.",
  file: "corner",
  angle: { from: [-0.6, 0.5, -0.6], zoom: 1, pan: [0, 0, 0] },
  defaults: { ...RAISED, angle: 90, radius: 6, turn: "Left", rise: 0, steps: 24, track: "Yellow" },
  ...raisedPiece(
    (v) => bendIn(v),
    (v) => [
      num("angle", "Angle", 15, 180, 15, "°"),
      num("radius", "Radius", 2, 30, 0.5, "m"),
      choice("turn", "Turn", ["Left", "Right"]),
      riseControl(mostRise(bendLength(v)), true),
      num("steps", "Pieces a turn", 8, 64, 1, undefined, true),
    ],
  ),
};

/* ---------- banked turn ---------- */
export const banked: Generator = {
  key: "banked",
  name: "Banked turn",
  category: "Racing",
  blurb: "A turn tipped in toward its middle, flat where it starts and ends so it meets the rest.",
  file: "banked_turn",
  angle: { from: [-0.75, 0.3, -0.6], zoom: 1, pan: [0, 0, 0] },
  defaults: {
    ...RAISED,
    angle: 180,
    radius: 8,
    bank: 30,
    turn: "Left",
    rise: 0,
    steps: 32,
    track: "Red",
  },
  ...raisedPiece(
    (v) => bendIn(v, numberIn(v, "bank") * DEG),
    (v) => [
      /* past three quarters of a turn a flat one would come back round into its own start */
      num("angle", "Angle", 30, 270, 15, "°"),
      num("radius", "Radius", 3, 30, 0.5, "m"),
      num("bank", "Banking", 5, 60, 1, "°"),
      choice("turn", "Turn", ["Left", "Right"]),
      riseControl(mostRise(bendLength(v)), true),
      num("steps", "Pieces a turn", 12, 64, 1, undefined, true),
    ],
  ),
};

/* ---------- s-bend ---------- */
export const sBendGen: Generator = {
  key: "s-bend",
  name: "S-bend",
  category: "Racing",
  blurb: "A bend one way and back, coming out beside where it went in and heading the same way.",
  file: "s_bend",
  angle: { from: [-0.5, 0.3, 0.8], zoom: 1, pan: [0, 0, 0] },
  defaults: { ...RAISED, length: 12, shift: 4, steps: 32, track: "Purple" },
  ...raisedPiece(sBendIn, (v) => {
    const most = Math.min(10, numberIn(v, "length"));
    return [
      num("length", "Length", 4, 40, 1, "m"),
      num("shift", "Shift to the right (below 0 left)", -most, most, 0.5, "m"),
      num("steps", "Pieces a turn", 12, 64, 1, undefined, true),
    ];
  }),
};

/* ---------- t junction ---------- */
export const tJunction: Generator = {
  key: "t-junction",
  name: "T junction",
  category: "Racing",
  blurb: "A track that meets a crossing one and splits left and right, a post to pick the way.",
  file: "t_junction",
  angle: { from: [-0.6, 0.45, 0.65], zoom: 1, pan: [0, 0, 0] },
  defaults: { ...RAISED, arm: 4, stem: 3, post: true, track: "Lime", postc: "Red" },
  ...raisedPiece(
    teeIn,
    () => [
      num("arm", "Arm length", 2, 20, 0.5, "m"),
      num("stem", "Stem length", 0, 20, 0.5, "m"),
      { key: "post", label: "Post to split the way", kind: "toggle" },
    ],
    (v) => (v.post ? [colour("postc", "Post")] : []),
  ),
};

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
    const r = radiusIn(v);
    const turns = numberIn(v, "turns");
    /* it starts on the camera's side (-X) and winds to the right */
    const p = setDown(
      placed(
        spiralSection(trackIn(v), {
          radius: r,
          turns,
          drop: metresIn(v, "drop"),
          bank: numberIn(v, "bank") * DEG,
          steps: numberIn(v, "steps"),
          column: v.column ? colourIn(v, "columnc") : undefined,
        }),
        { p: [-r, 0, 0], yaw: -Math.PI / 2 },
      ),
    );
    return fileOf([...itemsOf(p), ...supportsOf(p, "White")]);
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
    const t = trackIn(v);
    const lead = metresIn(v, "lead");
    const leads = lead > 0 ? [straightSection(t, lead)] : [];
    return fileOf(
      grounded(
        itemsOf(
          chain({ ...START, p: [-lead, 0, THICK] }, [
            ...leads,
            loopSection(t, metresIn(v, "radius"), numberIn(v, "steps")),
            ...leads,
          ]),
        ),
      ),
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
    const runup = metresIn(v, "runup");
    const s = jumpSection(trackIn(v), {
      runup,
      kick: numberIn(v, "kick") * DEG,
      gap: metresIn(v, "gap"),
      drop: metresIn(v, "drop"),
      landing: metresIn(v, "landing"),
    });
    /* raised so the lowest of it sits a metre up, off the floor */
    const p = setDown(s, 100, -runup);
    return fileOf([...itemsOf(p), ...(v.legs ? supportsOf(p, colourIn(v, "legc")) : [])]);
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
    const s = rollerSection(
      trackIn(v),
      L,
      numberIn(v, "bumps"),
      metresIn(v, "height"),
      numberIn(v, "steps"),
    );
    return fileOf(grounded(itemsOf(placed(s, { ...START, p: [-L / 2, 0, THICK] }))));
  },
};
