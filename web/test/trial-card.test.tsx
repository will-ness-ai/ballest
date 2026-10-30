// The card across the top of a Trial's board (TrackCard, as a Track's page draws it): Leth
// Trial #1 shows its own picture and links its ghost viewer, /leth/; a Tower, whose picture
// isn't extracted yet, has neither.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { TrackCard } from "../components/board/BoardTop";
import type { IndexBoard } from "../lib/player";

const board = (name: string, display: string): IndexBoard => ({
  name,
  group: "Trials",
  tier: null,
  display,
  entryCount: 2,
});
const card = (b: IndexBoard) => renderToStaticMarkup(<TrackCard b={b} rows={[]} scores={[]} />);

describe("a Trial's card", () => {
  test("Leth Trial #1: its picture, its name and a link to its ghost viewer", () => {
    const html = card(board("Map_LethTrial_01", "Leth Trial #1"));
    expect(html).toContain('src="/leth/screenshot.jpg"');
    expect(html).toContain("<h2>Leth Trial #1</h2>");
    expect(html).toMatch(/<a href="\/leth\/">Ghost viewer<\/a>/);
  });

  test("a Tower: no picture yet and no ghost viewer", () => {
    const html = card(board("Map_TheTower", "The Tower"));
    expect(html).not.toContain("<img");
    expect(html).toContain("<h2>The Tower</h2>");
    expect(html).not.toContain("Ghost viewer");
  });
});
