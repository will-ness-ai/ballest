// "See it in 3D" on a Map's page (spec #250): the panel offers it only for a Map whose file
// the site holds (fileVersion), and its full screen's card gives the record and the Medals.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { MapPanel } from "../components/workshop/MapView";
import type { WorkshopMap } from "../lib/rows";

const map = (fileVersion: string | null): WorkshopMap => ({
  pfid: "9000000001",
  name: "Workshop_9000000001",
  title: "Marble Run",
  creator: "Tenpin",
  cid: "76561199000000010",
  preview: null,
  created: 1_760_000_000,
  medals: [40, 30, 25, 20.5],
  entryCount: 3,
  sessions: 9,
  subs: 4,
  top3: [
    ["76561199000000001", "Ada", 1_826_700],
    ["76561199000000002", "Bo", 1_900_000],
    ["76561199000000003", "Cy", 2_000_000],
  ],
  gap13: 173_300,
  crowd: 1,
  authorBeaten: 3,
  fileVersion,
});

/* the markup's text, each element's edge a | */
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "|");
/* the markup of the <dl> with that class, or "" without one */
const within = (html: string, cls: string) =>
  new RegExp(`<dl class="${cls}">.*?</dl>`).exec(html)?.[0] ?? "";
const panel = (m: WorkshopMap) =>
  renderToStaticMarkup(<MapPanel m={m} scores={[1_826_700, 1_900_000, 2_000_000]} asOf={0} />);

test("a Map whose file the site holds has the button, and its card the record and Medals", () => {
  const html = panel(map("5101012345678901234"));
  expect(text(html)).toContain("|See it in 3D|");
  expect(html).toContain('aria-label="Marble Run in 3D"');
  const card = text(within(html, "m3d-card")).replace(/\|+/g, "|");
  expect(card).toBe(
    "|Record|0:18.267|Author|0:20.500|Gold|0:25.000|Silver|0:30.000|Bronze|0:40.000|",
  );
});

test("the panel lists the Medal times best first, as the card does", () => {
  const html = panel(map(null));
  const medals = text(within(html, "mp-medals")).replace(/\|+/g, "|");
  expect(medals).toBe("|Author|0:20.500|Gold|0:25.000|Silver|0:30.000|Bronze|0:40.000|");
});

test("a Map with no stored file has no button and no 3D view", () => {
  const html = panel(map(null));
  expect(html).not.toContain("See it in 3D");
  expect(html).not.toContain("m3d");
});
