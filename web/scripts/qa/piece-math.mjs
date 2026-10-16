// The framing `qa piece` and the game mesh renders it scores against share: three
// orthographic views of one piece in its own Unreal space (cm), each mapping two axes to the
// image's right and up, framed from the piece's bounds so its larger extent fills 90% of the
// image. Pure, so the page that draws the viewer's side and the tests read the same numbers.

/* axis indices into Unreal [x, y, z] */
export const VIEWS = [
  { name: "top", right: 0, up: 1 },
  { name: "front", right: 1, up: 2 },
  { name: "side", right: 0, up: 2 },
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

/* a point in the piece's space as [column, row] on a `size`-pixel image, rows counting down */
export function project(point, bounds, name, size) {
  const { right, up } = viewOf(name);
  const { cr, cu, span } = frameOf(bounds, name);
  return [((point[right] - cr) / span + 0.5) * size, (0.5 - (point[up] - cu) / span) * size];
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

/* one row per piece, worst view first; a piece with no reference renders sorts last */
export function rankRows(pieces) {
  const worst = (p) => (p.scores ? Math.min(...VIEWS.map((v) => p.scores[v.name])) : Infinity);
  const fmt = (n) => n.toFixed(2);
  return [...pieces]
    .sort((x, y) => worst(x) - worst(y))
    .map((p) => ({
      ...p,
      worst: p.scores ? fmt(worst(p)) : "no ref",
      ...Object.fromEntries(VIEWS.map((v) => [v.name, p.scores ? fmt(p.scores[v.name]) : ""])),
    }));
}
