import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { reach } from "../scripts/qa/reach.mjs";

// qa check's default: the catalogue pages a branch's changed files can reach, read from the
// repo's own files, so a page that stops importing a file stops being drawn for it.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const of = (changed: Array<string>) => reach(changed, ROOT);

describe("reach", () => {
  it("draws nothing for docs, tests and the bot", () => {
    expect(of(["docs/site.md", "web/test/nav.test.ts", "discord-bot/src/main.ts"])).toEqual({
      all: null,
      pages: [],
      routes: [],
    });
  });

  it("draws nothing for tooling: lint and test config", () => {
    expect(of(["eslint.config.js", "web/vitest.config.ts", ".gitignore"]).all).toBeNull();
  });

  it("draws everything for qa's own catalogue, which decides what is drawn", () => {
    expect(of(["web/scripts/qa/catalogue.mjs"]).all).toBe("web/scripts/qa/catalogue.mjs");
  });

  it("follows a library file's imports up to the pages that use it", () => {
    const r = of(["web/lib/generators/signs.ts"]);
    expect(r.all).toBeNull();
    expect(r.pages).toEqual([{ name: "prefabs-make", via: "web/lib/generators/signs.ts" }]);
  });

  it("names a page the catalogue doesn't draw, as a gap", () => {
    expect(of(["web/lib/generators/signs.ts"]).routes).toContain(
      "web/app/prefabs/make/[generator]/page.tsx",
    );
  });

  it("matches a page's file to the catalogue paths it serves", () => {
    expect(of(["web/app/daily/standings/page.tsx"]).pages.map((p) => p.name)).toEqual([
      "daily-standings",
    ]);
    expect(of(["web/app/vs/[a]/[b]/page.tsx"]).pages.map((p) => p.name)).toEqual(["vs"]);
  });

  it("draws everything for the root layout and the proxy, which every page goes through", () => {
    expect(of(["web/app/layout.tsx"]).all).toBe("web/app/layout.tsx");
    expect(of(["web/proxy.ts"]).all).toBe("web/proxy.ts");
  });

  it("draws everything for a site file no page imports, such as an API route", () => {
    expect(of(["web/app/api/me/route.ts"]).all).toBe("web/app/api/me/route.ts");
  });
});
