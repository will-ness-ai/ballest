// @vitest-environment happy-dom
// All maps narrowed by the query the site search's "All N Maps matching" link carries
// (/maps?q=), read from the address as the page does in a browser: only the Maps whose title
// or maker contains it, counted, with a way back to every Map.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AllMaps } from "../components/workshop/AllMaps";
import type { MapCard } from "../lib/workshop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const address = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/maps",
  useSearchParams: () => new URLSearchParams(address.search),
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, ...rest }: { href: string } & React.ComponentProps<"a">) => (
    <a href={href} {...rest} />
  ),
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

let el: HTMLElement, root: Root;
beforeEach(() => {
  el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  el.remove();
});

const at = (search: string) => {
  address.search = search;
  act(() => {
    root.render(<AllMaps maps={maps} view={null} asOf={0} />);
  });
  return el.innerHTML;
};

describe("All maps with a query in the address", () => {
  test("lists only the Maps whose title or maker contains it", () => {
    const html = at("?q=SOLAR");
    expect(html).toContain("Solar Trials Mercury");
    expect(html).toContain("Cliffs");
    expect(html).not.toContain("Marble Run");
    expect(html).toContain("2 maps matching");
    expect(html).toMatch(/href="\/maps"[^>]*>Show every map/);
  });

  test("says no Map matches a query that finds none, rather than blaming the filters", () => {
    const html = at("?q=zzz");
    expect(el.querySelector(".empty")?.textContent).toBe("No map matches “zzz”.");
    expect(html).toMatch(/href="\/maps"[^>]*>Show every map/);
    expect(html).not.toContain("filters");
  });

  test("without one, lists every Map", () => {
    const html = at("");
    expect(html).toContain("Marble Run");
    expect(html).not.toContain("matching");
  });
});
