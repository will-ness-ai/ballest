// A Map nobody has a time on yet (spec #259): a new Map's page shows the Map and its Medals, and
// its board says it has no runs, instead of sending the link home, until a Refresh brings times.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { MapPanel } from "../components/workshop/MapView";
import type { WorkshopMap } from "../lib/rows";

const fresh = (fileVersion: string | null = null): WorkshopMap => ({
  pfid: "3821808619",
  name: "Workshop_3821808619",
  title: "Limbo campaign A08 of 8",
  creator: "DanielProp",
  cid: "76561199000000010",
  preview: null,
  created: 1_792_272_393,
  medals: [60, 45, 40, 35],
  entryCount: 0,
  sessions: 0,
  subs: 0,
  top3: [],
  gap13: null,
  crowd: 0,
  authorBeaten: 0,
  fileVersion,
});

const text = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|");

test("a new Map's panel has its Medals and Workshop link, no record, and says it has no runs", () => {
  const t = text(renderToStaticMarkup(<MapPanel m={fresh()} scores={[]} asOf={0} />));
  expect(t).toContain("|Limbo campaign A08 of 8|");
  expect(t).toContain("|Author|0:35.000|");
  expect(t).toContain("|Open in Steam Workshop|");
  expect(t).not.toContain("Record");
  expect(t).toContain("|No runs yet.|");
});

test("a new Map's 3D card has the Medals and no Record row", () => {
  const html = renderToStaticMarkup(<MapPanel m={fresh("51010")} scores={[]} asOf={0} />);
  const card = /<dl class="m3d-card">.*?<\/dl>/.exec(html)?.[0] ?? "";
  expect(text(card)).toBe("|Author|0:35.000|Gold|0:40.000|Silver|0:45.000|Bronze|1:00.000|");
});
