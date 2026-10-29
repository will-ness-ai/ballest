// qa check's changed views where only the numbers moved. The preview and production read one
// database, but their caches can be a Refresh apart, so play counts, ranks and times differ
// with no change to the code; such a view is still listed, marked as live data. From two
// draws' text layouts (textLayout in probes.mjs): numberLines says where the numbers changed,
// and compare.mjs counts the changed pixels outside those boxes, which must be none.

// a number with its separators (1,204; 0:10.267) and an ordinal's suffix (12th)
const NUMBER = /\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?/g;
// a box's rounding between two draws
const SLACK = 1;
// around a changed line: its glyphs' anti-aliasing reaches a little past its box
const PAD = 2;

/** @typedef {{ text: string, x: number, y: number, w: number, h: number }} Line */

/**
 * The boxes of the lines whose numbers changed, and of the lines on their rows that a longer
 * number moved along, on both sides, padded; or null when anything else changed: a line came
 * or went, a line's words changed, a changed line moved up or down or grew taller, or a line
 * whose text is the same moved anywhere else. Null too when no text changed at all, as with a
 * change of style.
 * @param {ReadonlyArray<Line> | undefined} was
 * @param {ReadonlyArray<Line> | undefined} is
 * @returns {Array<[number, number, number, number]> | null} x, y, right, bottom
 */
export function numberLines(was, is) {
  if (!was || !is || was.length !== is.length) return null;
  const near = (a, b, keys) => keys.every((k) => Math.abs(a[k] - b[k]) <= SLACK);
  const box = (l) => [l.x - PAD, l.y - PAD, l.x + l.w + PAD, l.y + l.h + PAD];
  const pairs = was.map((a, i) => [a, is[i]]);
  const changed = pairs.filter(([a, b]) => a.text !== b.text);
  for (const [a, b] of changed)
    if (a.text.replace(NUMBER, "#") !== b.text.replace(NUMBER, "#") || !near(a, b, ["y", "h"]))
      return null;
  if (!changed.length) return null;
  /* a line moved along by a number before it sits within that number's row */
  const onRow = (l) => changed.some(([a]) => l.y >= a.y - SLACK && l.y < a.y + a.h);
  const moved = [];
  for (const [a, b] of pairs.filter(([a, b]) => a.text === b.text))
    if (near(a, b, ["x", "y", "w", "h"])) continue;
    else if (near(a, b, ["y", "w", "h"]) && onRow(a)) moved.push([a, b]);
    else return null;
  return [...changed, ...moved].flatMap(([a, b]) => [box(a), box(b)]);
}
