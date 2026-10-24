// qa check's scroll fault: a view that lands somewhere else on load than on the reference,
// which the screenshot from the top can't show. From two runs' probes (probes.mjs).

// a few rows either way is the content around it changing height
const SLACK = 40;

/**
 * What moved between the reference's probes `was` and the target's `is`, or null. Where both
 * pages scrolled to a row (`landed`, its top in the window), the row's place in the window
 * is compared, so a taller head above it moves the page but is no fault; where neither had
 * to scroll, or one has no row, the page's own offset is.
 */
export function landsElsewhere(was, is) {
  const rows = was.landed != null && is.landed != null;
  if (rows && (was.scrolled > 0 || is.scrolled > 0))
    return Math.abs(was.landed - is.landed) > SLACK
      ? `row at ${String(is.landed)}px in the window, was ${String(was.landed)}px`
      : null;
  return Math.abs(was.scrolled - is.scrolled) > SLACK
    ? `lands at ${String(is.scrolled)}px, was ${String(was.scrolled)}px`
    : null;
}
