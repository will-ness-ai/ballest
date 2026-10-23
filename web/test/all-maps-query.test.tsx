// All maps narrowed by the query the site search's "All N Maps matching" link carries
// (/maps?q=): only the Maps whose title or maker contains it, counted, with a way back to
// every Map.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { AllMaps } from "../components/workshop/AllMaps";
import type { MapCard } from "../lib/workshop";

vi.mock("next/navigation", () => ({
  usePathname: () => "/maps",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined }),
}));

let n = 0;
const card = (o: Partial<MapCard> = {}): MapCard => ({
  pfid: String(1000 + n++),
  title: "Map " + String(n),
  creator: "Maker",
  cid: "76561199000000001",
  preview: null,
  created: 0,
  author: 20,
  entryCount: 10,
  sessions: 10,
  top3: [["76561199000000002", "Rae", 1_500_000]],
  gap13: null,
  crowd: 1,
  authorBeaten: 0,
  ...o,
});

const maps = [
  card({ title: "Solar Trials Mercury" }),
  card({ title: "Cliffs", creator: "Solaris" }),
  card({ title: "Marble Run" }),
];

describe("All maps with a query", () => {
  test("lists only the Maps whose title or maker contains it", () => {
    const html = renderToStaticMarkup(<AllMaps maps={maps} view={null} asOf={0} query="SOLAR" />);
    expect(html).toContain("Solar Trials Mercury");
    expect(html).toContain("Cliffs");
    expect(html).not.toContain("Marble Run");
    expect(html).toContain("2 maps matching");
    expect(html).toMatch(/href="\/maps"[^>]*>Show every map/);
  });

  test("without one, lists every Map", () => {
    const html = renderToStaticMarkup(<AllMaps maps={maps} view={null} asOf={0} />);
    expect(html).toContain("Marble Run");
    expect(html).not.toContain("matching");
  });
});
