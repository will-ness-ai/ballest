// The path a page is at, as the browser has it (pagePath in lib/routes.ts).
import { describe, expect, test } from "vitest";

import { navOf, type NavFacts } from "../lib/nav";
import { pagePath } from "../lib/routes";

const FACTS: NavFacts = { workshop: true, daily: true, seasons: [], campaigns: [] };

describe("the path a page is at", () => {
  test("the homepage's /index is /", () => {
    expect(pagePath("/index")).toBe("/");
    expect(pagePath("/index/")).toBe("/");
  });
  test("the homepage's header lights Featured either way", () => {
    expect(navOf(pagePath("/index"), FACTS).subs).toEqual([
      { label: "Featured", href: "/", on: true },
      { label: "All Maps", href: "/maps", on: false },
    ]);
  });
  test("every other path is itself", () => {
    for (const p of ["/", "/maps", "/daily/standings", "/campaign/index", "/index/x"])
      expect(pagePath(p)).toBe(p);
  });
});
