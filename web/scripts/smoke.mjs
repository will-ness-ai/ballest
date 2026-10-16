// Requests every route the app serves and every static file the pages load from a running
// build seeded with the tiny dataset (or stress, which holds all of tiny), so a broken page or
// a site file SITE in sync-site.mjs leaves out fails here rather than in production. Prints only
// failures and a summary line.
//
//   pnpm db:seed tiny && pnpm build && pnpm start &   then   node scripts/smoke.mjs [base URL]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const root = fileURLToPath(new URL("../../", import.meta.url));

/* tiny's players and Maps (db/seed/datasets/tiny.ts) */
const P1 = "76561199000000001",
  P2 = "76561199000000002",
  MAP = "9000000001";
const ORIGIN = "https://ballestrecords.com";

// [path, status, Location for a redirect, text the page must contain]
const ROUTES = [
  ["/", 200],
  ["/maps", 200],
  ["/maps/new", 200],
  ["/maps/nope", 404],
  ["/api/maps?q=marble", 200, null, "Marble Run"],
  ["/board/Map_Track13", 200, null, "Rolling Rae"],
  ["/board/Map_Track13/" + P1, 200],
  ["/board/OverallLeaderboard_EASeason2", 200],
  ["/board/OverallLeaderboard_EASeason2/podiums", 200],
  ["/board/OverallLeaderboard_S1Current", 200, null, "Rolling Rae"],
  ["/board/OverallLeaderboard_AllSeasons", 200],
  ["/board/Map_Nope", 404],
  ["/board/Map_Track13/nope", 404],
  ["/board/Map_Track13/podiums/x", 404],
  ["/board/%E0", 404],
  ["/map/" + MAP, 200, null, "Marble Run"],
  ["/map/" + MAP + "/" + P1, 200],
  ["/map/" + MAP + "/nope", 404],
  ["/player/" + P1, 200, null, "Rolling Rae"],
  ["/player/" + P1 + "/circuit", 200],
  ["/player/" + P1 + "/workshop", 200],
  ["/player/" + P1 + "/made", 200],
  ["/player/" + P1 + "/daily", 200, null, "Days in a row"],
  ["/player/" + P1 + "/nope", 404],
  ["/player/nope", 404],
  ["/vs/" + P1 + "/" + P2, 200, null, "Rolling Rae"],
  ["/vs/" + P1 + "/" + P1, 307, "/player/" + P1],
  ["/api/player/" + P1, 200, null, "Rolling Rae"],
  ["/api/player/76561199000000099", 404],
  ["/api/players?q=rae", 200, null, "Rolling Rae"],
  ["/players", 200],
  ["/players/circuit/pod", 200],
  ["/players/workshop/maps", 200, null, "with a Workshop time"],
  ["/players/circuit/maps", 307, "/players/circuit/wr"],
  ["/players/workshop", 307, "/players/workshop/wr"],
  ["/players/nope/wr", 404],
  ["/daily", 200, null, "Fresh Fields"],
  ["/daily/2026-08-30", 200, null, "Justy Sparks"],
  // another day's title is only in the calendar
  ["/daily/2026-08-29", 200, null, "Fresh Fields"],
  ["/daily/2026-07-01", 200, null, "NEXT_REDIRECT;replace;/daily;"],
  // p2 holds the most podiums; a name links to the player's Daily tab
  ["/daily/standings", 200, null, "Justy Sparks"],
  ["/daily/standings/x", 404],
  ["/daily/not-a-date", 404],
  // Where you stand: the four lists' top 3 for anyone, You's cards and Show all's slices
  // from the standings API; the Players tab links to it
  ["/you", 200, null, "Most world records"],
  ["/you", 200, null, '<link rel="canonical" href="' + ORIGIN + '/you"'],
  ["/you/x", 404],
  ["/players", 200, null, 'href="/you"'],
  ["/api/standings", 200, null, '"lists"'],
  ["/api/standings?ladders&player=" + P1, 200, null, '"chase"'],
  ["/api/standings?ladders&player=nope", 400],
  ["/api/standings?list=played&from=0&count=2", 200, null, "Rolling Rae"],
  ["/api/standings?list=podiums", 400],
  ["/daily/2026-02-30", 404],
  ["/daily/2026-08-30/" + P1, 404],
  ["/api/board/Map_Track13?from=0&count=2", 200],
  ["/api/board/Map_Track13?q=rae", 200],
  ["/api/board/Workshop_123?from=0", 404],
  ["/api/tracks", 200, null, "17800617"],
  // share images (lib/share.ts): a PNG for a page that exists, a 404 for one that doesn't,
  // and the pages naming theirs
  ["/og/player/" + P1, 200, null, "PNG"],
  ["/og/player/76561199000000099", 404],
  ["/og/map/" + MAP, 200, null, "PNG"],
  ["/og/map/1", 404],
  ["/og/track/Map_Track13", 200, null, "PNG"],
  ["/og/track/Map_Nope", 404],
  ["/og/track/OverallLeaderboard_EASeason2", 404],
  ["/og/daily/2026-08-30", 200, null, "PNG"],
  ["/og/daily/2026-07-01", 404],
  ["/og/nope/1", 404],
  [
    "/player/" + P1 + "/circuit",
    200,
    null,
    '<meta property="og:image" content="https://ballestrecords.com/og/player/' + P1 + "?v=",
  ],
  ["/map/" + MAP, 200, null, "/og/map/" + MAP + "?v="],
  ["/board/Map_Track13", 200, null, "/og/track/Map_Track13?v="],
  ["/daily", 200, null, "/og/daily/"],
  ["/leth", 301, "/leth/"],
  ["/leth/", 200],
  ["/multiballs/terms", 200],
  ["/multiballs/privacy", 200],
  ["/robots.txt", 200, null, "Disallow: /player/*/"],
  ["/robots.txt", 200, null, "Sitemap: https://ballestrecords.com/sitemap.xml"],
  ["/sitemap.xml", 200, null, "<loc>https://ballestrecords.com/map/" + MAP + "</loc>"],
  // canonical addresses (docs/site.md): a view names the page it views, and each Daily is
  // its own
  [
    "/player/" + P1 + "/circuit",
    200,
    null,
    '<link rel="canonical" href="https://ballestrecords.com/player/' + P1 + '"',
  ],
  [
    "/board/OverallLeaderboard_EASeason2/podiums",
    200,
    null,
    '<link rel="canonical" href="https://ballestrecords.com/board/OverallLeaderboard_EASeason2"',
  ],
  [
    "/map/" + MAP + "/" + P1,
    200,
    null,
    '<link rel="canonical" href="' + ORIGIN + "/map/" + MAP + '"',
  ],
  ["/maps/new", 200, null, '<link rel="canonical" href="' + ORIGIN + '/maps"'],
  ["/players/circuit/pod", 200, null, '<link rel="canonical" href="' + ORIGIN + '/players"'],
  ["/daily/2026-08-30", 200, null, '<link rel="canonical" href="' + ORIGIN + '/daily/2026-08-30"'],
  ["/", 200, null, '"@type":"WebSite"'],
  ["/", 200, null, "<title>Ballest of Them All Records: "],
  ["/no-such-page", 404],
];

// The static files the pages load: the icons and link preview the layout names, every
// Circuit screenshot, and what the two pages outside the app reference.
function refs(page) {
  const html = readFileSync(join(root, page), "utf8");
  const dir = posix.dirname("/" + page);
  const out = [];
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^([a-z]+:|#)/.test(ref)) continue;
    out.push(ref.startsWith("/") ? ref : posix.join(dir, ref));
  }
  return out;
}
const STATIC = [
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/og.png",
  ...readdirSync(join(root, "circuit")).map((f) => "/circuit/" + f),
  ...["leth/index.html", "multiballs/terms.html", "multiballs/privacy.html"].flatMap(refs),
].filter((p) => statSync(join(root, p), { throwIfNoEntry: false })?.isFile());

const failures = [];
let checked = 0;

for (const [path, status, location, text] of ROUTES) {
  checked++;
  const res = await fetch(base + path, { redirect: "manual" });
  const loc = res.headers.get("location")?.replace(base, "");
  if (res.status !== status || (location && loc !== location))
    failures.push(
      `${path}: ${res.status}${loc ? " -> " + loc : ""}, expected ${status}${location ? " -> " + location : ""}`,
    );
  else if (text && !(await res.text()).includes(text)) failures.push(`${path}: no "${text}"`);
}

for (const path of new Set(STATIC)) {
  checked++;
  const res = await fetch(base + path);
  if (res.status !== 200) {
    failures.push(`${path}: ${res.status}`);
    continue;
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.equals(readFileSync(join(root, path))))
    failures.push(`${path}: differs from the repo file`);
}

for (const f of failures) console.log("FAIL " + f);
console.log(`${checked} URLs checked, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
