import { describe, expect, it } from "vitest";

import { landsElsewhere } from "../scripts/qa/landing.mjs";

// qa's scroll fault: a view that scrolls to its row on load (an entry or race page) landing
// somewhere else than on the reference, which the screenshot from the top can't show.
describe("landsElsewhere", () => {
  it("goes by where the row sits in the window, so a taller head above it is no fault", () => {
    const was = { scrolled: 900, landed: 425 };
    expect(landsElsewhere(was, { scrolled: 1060, landed: 425 })).toBeNull();
  });

  it("leaves a row near the top alone when neither page had to scroll to it", () => {
    expect(landsElsewhere({ scrolled: 0, landed: 300 }, { scrolled: 0, landed: 460 })).toBeNull();
  });

  it("finds the row sitting somewhere else in the window", () => {
    expect(landsElsewhere({ scrolled: 900, landed: 425 }, { scrolled: 900, landed: 600 })).toBe(
      "row at 600px in the window, was 425px",
    );
  });

  it("finds a page that no longer scrolls to its row", () => {
    expect(landsElsewhere({ scrolled: 900, landed: 425 }, { scrolled: 0, landed: null })).toBe(
      "lands at 0px, was 900px",
    );
  });

  it("goes by the page's offset where neither side has a row to land on", () => {
    expect(
      landsElsewhere({ scrolled: 0, landed: null }, { scrolled: 30, landed: null }),
    ).toBeNull();
    expect(landsElsewhere({ scrolled: 0, landed: null }, { scrolled: 300, landed: null })).toBe(
      "lands at 300px, was 0px",
    );
  });
});
