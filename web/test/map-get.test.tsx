// "Get it in Ballest" on a Map's page (spec #359, ticket #361): the link to the Map's
// Workshop page sits under the picture, beside "See it in 3D" when the Map has a 3D view,
// with the line saying what to do after subscribing under them.
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
  top3: [],
  gap13: null,
  crowd: 1,
  authorBeaten: 0,
  fileVersion,
});

/* the markup's text, each element's edge a | */
const text = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|");
const panel = (m: WorkshopMap) => renderToStaticMarkup(<MapPanel m={m} scores={[]} asOf={0} />);
/* the row under the picture, with the 3D view's dialog (closed, drawn nothing) left out */
const row = (html: string) =>
  (/<div class="mp-get">.*?<\/a><\/div>/.exec(html)?.[0] ?? "").replace(/<dialog.*?<\/dialog>/, "");

test("a Map with a 3D view has Get it in Ballest beside See it in 3D, then the line", () => {
  const html = panel(map("5101012345678901234"));
  expect(text(row(html))).toBe("|See it in 3D|Get it in Ballest ↗|");
  expect(row(html)).toContain(
    'href="https://steamcommunity.com/sharedfiles/filedetails/?id=9000000001" target="_blank"',
  );
  const after = html.slice(html.indexOf('<div class="mp-get">')).replace(/^.*?<\/a><\/div>/, "");
  expect(after.replace(/<[^>]+>/g, "")).toMatch(
    /^Press Subscribe on Steam, then in Ballest go to the Hub and press Downloads\./,
  );
});

test("a Map with no 3D view has Get it in Ballest alone in its row", () => {
  const html = panel(map(null));
  expect(text(row(html))).toBe("|Get it in Ballest ↗|");
});

test("the panel no longer says Open in Steam Workshop", () => {
  expect(panel(map(null))).not.toContain("Open in Steam Workshop");
});
