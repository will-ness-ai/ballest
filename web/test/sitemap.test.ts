// What /sitemap.xml lists (lib/sitemap.ts), and that robots.txt (app/robots.ts) lets a
// crawler read every page on it.
import { describe, expect, test } from "vitest";

import robots from "../app/robots";
import { CIRCUIT } from "../lib/circuit";
import { SITE_ORIGIN } from "../lib/routes";
import type { StandingsRow } from "../lib/rows";
import { sitemapOf } from "../lib/sitemap";

const row = (id: string, counts: Array<number>): StandingsRow =>
  [id, "p" + id, ...counts] as StandingsRow;

const DATA = {
  maps: ["3001", "3002"],
  dailies: [
    { date: "2026-10-09", endsAt: "2026-10-10T00:00:00.000Z", final: true },
    { date: "2026-10-10", endsAt: "2026-10-11T00:00:00.000Z", final: false },
  ],
  campaigns: ["solar-trials"],
  players: [
    row("76561198000000001", [1, 0, 0, 0, 0, 0, 0]), // a Circuit world record
    row("76561198000000002", [0, 0, 0, 1, 0, 0, 0]), // a Workshop podium
    row("76561198000000003", [0, 0, 0, 0, 3, 2, 40]), // top 5s and Maps only
  ],
};
const entries = sitemapOf(DATA);
const paths = entries.map((e) => e.url.slice(SITE_ORIGIN.length));

describe("sitemapOf", () => {
  test("every URL is on the production address", () => {
    for (const e of entries) expect(e.url.startsWith(SITE_ORIGIN + "/")).toBe(true);
  });

  test("lists the site's own pages, every Circuit board, Map, Daily and Campaign", () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/maps",
        "/players",
        "/daily",
        "/daily/standings",
        "/map/3001",
        "/map/3002",
        "/daily/2026-10-09",
        "/daily/2026-10-10",
        "/campaigns",
        "/campaign/solar-trials",
        ...CIRCUIT.map((b) => "/board/" + b.name),
        /* the Towers' pages, as Trials */
        "/board/Map_TheTower",
        "/board/Map_TheTowerCP",
      ]),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("lists a player only with a world record or podium", () => {
    expect(paths).toContain("/player/76561198000000001");
    expect(paths).toContain("/player/76561198000000002");
    expect(paths).not.toContain("/player/76561198000000003");
  });

  test("dates only a final Daily, by its close", () => {
    const at = (path: string) => entries.find((e) => e.url === SITE_ORIGIN + path);
    expect(at("/daily/2026-10-09")?.lastModified).toBe("2026-10-10T00:00:00.000Z");
    expect(at("/daily/2026-10-10")?.lastModified).toBeUndefined();
    expect(at("/")?.lastModified).toBeUndefined();
  });
});

describe("robots.txt", () => {
  const r = robots();
  const rules = [r.rules].flat();

  test("names the sitemap", () => {
    expect(r.sitemap).toBe(SITE_ORIGIN + "/sitemap.xml");
  });

  test("allows every page the sitemap lists", () => {
    /* a robots.txt path is a prefix in which * matches anything */
    const blocked = rules
      .flatMap((x) => [x.disallow ?? []].flat())
      .map((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")));
    for (const p of paths)
      expect(
        blocked.filter((re) => re.test(p)),
        p,
      ).toEqual([]);
  });
});
