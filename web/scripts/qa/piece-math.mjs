// The framing `qa piece` and the game mesh renders it scores against share: three
// orthographic views of one piece in its own Unreal space (cm), each mapping two axes to the
// image's right and up, framed from the piece's bounds so its larger extent fills 90% of the
// image. Pure, so the page that draws the viewer's side and the tests read the same numbers.

/* axis indices into Unreal [x, y, z] for the image's right and up, and the side the camera
   sits on as [axis, sign]. The game mesh renders in ballest-map-making follow this table. */
export const VIEWS = [
  { name: "top", right: 0, up: 1, toward: [2, 1] },
  { name: "front", right: 1, up: 2, toward: [0, -1] },
  { name: "side", right: 0, up: 2, toward: [1, -1] },
];
const FILL = 0.9;

const viewOf = (name) => VIEWS.find((v) => v.name === name);

/* the centre of the view along its right and up axes, and the cm one image side spans */
export function frameOf({ min, max }, name) {
  const { right, up } = viewOf(name);
  const er = max[right] - min[right];
  const eu = max[up] - min[up];
  return {
    cr: (min[right] + max[right]) / 2,
    cu: (min[up] + max[up]) / 2,
    span: Math.max(er, eu) / FILL,
  };
}

/* an Unreal axis as a unit vector in three's space (y and z swapped, as lib/prefab.ts converts) */
function inThree(axis, sign = 1) {
  const v = [0, 0, 0];
  v[[0, 2, 1][axis]] = sign;
  return v;
}

/**
 * The view's camera axes in three: right, up and toward the camera. Some views are mirror
 * images (three's axes are Unreal's reflected), which no camera can draw: those turn their
 * right axis round, and the picture is flipped back left to right (`mirrored`).
 */
export function camera(view) {
  const right = inThree(view.right);
  const up = inThree(view.up);
  const toward = inThree(...view.toward);
  const cross = [
    right[1] * up[2] - right[2] * up[1],
    right[2] * up[0] - right[0] * up[2],
    right[0] * up[1] - right[1] * up[0],
  ];
  const mirrored = cross.reduce((sum, c, i) => sum + c * toward[i], 0) < 0;
  return { right: mirrored ? right.map((x) => (x ? -x : 0)) : right, up, toward, mirrored };
}

/* intersection over union of two outlines, one 0/1 per pixel; two empty outlines match */
export function overlap(a, b) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either ? both / either : 1;
}

export const fmt = (n) => n.toFixed(2);

/* one row per piece, worst view first; a piece with no reference renders sorts last */
export function rankRows(pieces) {
  const worst = (p) => (p.scores ? Math.min(...VIEWS.map((v) => p.scores[v.name])) : Infinity);
  return [...pieces]
    .sort((x, y) => worst(x) - worst(y))
    .map((p) => ({
      ...p,
      worst: p.scores ? fmt(worst(p)) : "no ref",
      ...Object.fromEntries(VIEWS.map((v) => [v.name, p.scores ? fmt(p.scores[v.name]) : ""])),
    }));
}
