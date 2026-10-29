// qa check's changed views where only the numbers moved. The preview and production read one
// database, but their caches can be a Refresh apart, so play counts, ranks and times differ
// with no change to the code; such a view is still listed, marked as live data. From two
// runs' text layouts (textLayout in probes.mjs).

// a number with its separators (1,204; 0:10.267) and an ordinal's suffix (12th)
const NUMBER = /\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?/g;
const DIGIT = /\d/;
// a box's rounding between two draws
const SLACK = 1;

/** @typedef {{ text: string, x: number, y: number, w: number, h: number }} Line */

/**
 * True when `was` and `is` hold the same lines of text, each the same once its numbers are
 * set aside, at least one number differs, and every line keeps its place: a line without a
 * number keeps its box, and one with a number keeps its top and height, as a longer number
 * widens it and, set right, moves it along.
 * @param {ReadonlyArray<Line> | undefined} was
 * @param {ReadonlyArray<Line> | undefined} is
 */
export function onlyNumbers(was, is) {
  if (!was || !is || was.length !== is.length) return false;
  let moved = false;
  for (const [i, a] of was.entries()) {
    const b = is[i];
    if (a.text.replace(NUMBER, "#") !== b.text.replace(NUMBER, "#")) return false;
    if (a.text !== b.text) moved = true;
    /* a number may widen its own line, and move it along when it is set right */
    const fixed = DIGIT.test(a.text) ? ["y", "h"] : ["x", "y", "w", "h"];
    if (fixed.some((k) => Math.abs(a[k] - b[k]) > SLACK)) return false;
  }
  return moved;
}
