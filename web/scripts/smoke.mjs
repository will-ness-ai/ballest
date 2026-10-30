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

/* what a page that calls notFound() after it has started streaming answers with */
const SOFT_404 = "NEXT_HTTP_ERROR_FALLBACK;404";

// [path, status, Location for a redirect, text the page must contain]
const ROUTES = [
  ["/", 200],
  ["/maps", 200],
  ["/maps/new", 200],
  ["/maps/nope", 404],
  ["/api/maps?q=marble", 200, null, "Marble Run"],
  // the site search: a player and their Map, and nothing for an empty query
  ["/api/search?q=tenpin", 200, null, "Marble Run"],
  ["/api/search?q=", 200, null, "null"],
  ["/board/Map_Track13", 200, null, "Rolling Rae"],
  ["/board/Map_Track13/" + P1, 200],
  ["/board/OverallLeaderboard_EASeason2", 200],
  ["/board/OverallLeaderboard_EASeason2/podiums", 200],
  ["/board/OverallLeaderboard_S1Current", 200, null, "Rolling Rae"],
  ["/board/OverallLeaderboard_AllSeasons", 200],
  // a Trial's board: tiny's Tower record is Slowpoke's, and the rail names every Trial
  ["/board/Map_TheTower", 200, null, "Slowpoke"],
  ["/board/Map_TheTowerCP", 200, null, "Leth Trial #1"],
  // /trials: a card per Trial, each with its record's holder and runs
  ["/trials", 200, null, "Slowpoke"],
  ["/trials", 200, null, 'href="/board/Map_TheTowerCP"'],
  ["/trials", 200, null, "Leth Trial #1"],
  ["/api/search?q=the%20tower", 200, null, "Map_TheTowerCP"],
  ["/board/Map_Nope", 404],
  ["/board/Map_Track13/nope", 404],
  ["/board/Map_Track13/podiums/x", 404],
  ["/board/%E0", 404],
  ["/map/" + MAP, 200, null, "Marble Run"],
  ["/map/" + MAP + "/" + P1, 200],
  ["/map/" + MAP + "/nope", 404],
  // Marble Run's file and its 3D button; Loop de Loop's file hasn't been read
  ["/map/" + MAP, 200, null, "See it in 3D"],
  ["/map/" + MAP + "/file?v=5101012345678901234", 200, null, '"userLevelName": "Marble Run"'],
  ["/map/9000000002/file", 404],
  ["/map/" + MAP + "/file/x", 404],
  /* stress lists one curated Campaign's Map, Solar Trials' first (Mercury), so Solar Trials
     is listed and every other Campaign isn't. A path no curated Campaign can have is a real
     404 (proxy.ts); an unlisted Campaign, or a Map of a listed one the Workshop doesn't
     list, is only known to the page: a soft 404, the not-found page with a 200 */
  ["/campaigns", 200, null, "Solar Trials"],
  ["/", 200, null, "Solar Trials"],
  /* Trending this week: stress records plays for Rocky Alpine, Mercury and tiny's Marble Run */
  ["/", 200, null, "Trending this week"],
  ["/campaign/solar-trials", 200, null, "Twizzle"],
  ["/campaign/solar-trials", 200, null, "/og/campaign/solar-trials?v="],
  ["/campaign/solar-trials/podiums", 200, null, "Twizzle"],
  ["/campaign/solar-trials/" + P1, 200, null, "Rolling Rae"],
  ["/campaign/solar-trials/3805399883", 200, null, "01 Mercury"],
  ["/og/campaign/solar-trials", 200, null, "PNG"],
  // the Leth Trials, pinned, of one Event board
  ["/campaign/leth-trials", 200, null, "Lethamyr"],
  ["/campaign/leth-trials/leth-trial-1", 200, null, "Ghost viewer"],
  ["/api/board/Map_LethTrial_01?from=0&count=3", 200, null, "Twizzle"],
  // a row after the Event's id is marked on the Event's board: Slowpoke's plate
  ["/campaign/leth-trials/leth-trial-1/76561199000000004", 200, null, 'class="plate focus"'],
  ["/campaign/solar-trials/3805399883/76561199000000004", 404],
  ["/campaign/solar-trials/3805394429", 200, null, SOFT_404],
  ["/campaign/ajc", 200, null, SOFT_404],
  ["/campaign/ajc/podiums", 200, null, SOFT_404],
  ["/campaign/ajc/" + P1, 200, null, SOFT_404],
  ["/campaign/ajc/3646349274", 200, null, SOFT_404],
  ["/og/campaign/ajc", 404],
  ["/campaign/nope", 404],
  ["/campaign/solar-trials/nope", 404],
  ["/campaign/solar-trials/podiums/x", 404],
  // Velocity Trials' first Map, shaped like a Steam ID
  ["/campaign/solar-trials/3803908791", 404],
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
  ["/og/track/Map_TheTower", 200, null, "PNG"],
  ["/og/track/Map_Nope", 404],
  ["/og/track/OverallLeaderboard_EASeason2", 404],
  ["/og/daily/2026-08-30", 200, null, "PNG"],
  ["/og/daily/2026-07-01", 404],
  ["/og/nope/1", 404],
  // a player's Stat Card (lib/stat-card.ts), which Multiballs fetches
  ["/og/stats/" + P1 + "?v=1", 200, null, "PNG"],
  ["/og/stats/76561199000000099", 404],
  ["/og/stats/nope", 404],
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
    "/campaign/leth-trials/leth-trial-1",
    200,
    null,
    '<link rel="canonical" href="https://ballestrecords.com/campaign/leth-trials"',
  ],
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
  ["/", 200, null, "<title>BALLESTRECORDS: Ballest of Them All "],
  // Prefabs (tiny's two): a page, its file as an attachment, and a gone one
  ["/prefabs", 200, null, "Twin cubes"],
  ["/prefabs", 200, null, '<link rel="canonical" href="' + ORIGIN + '/prefabs"'],
  ["/prefabs/new", 200, null, "Upload a prefab"],
  // the Generators: Make your own, a Generator, and one that isn't (a key no Generator will
  // ever take: a real word fails here the day a Generator is named it)
  ["/prefabs/make", 200, null, '<h1 class="ph-title">Make a prefab</h1>'],
  ["/prefabs/guide", 200, null, "ballest.editor.saveprefab my_prefab"],
  ["/prefabs/guide", 200, null, '<link rel="canonical" href="' + ORIGIN + '/prefabs/guide"'],
  ["/prefabs/make/sign", 200, null, "Sign"],
  ["/prefabs/make/tree", 200, null, "Tree"],
  ["/prefabs/make/bush", 200, null, "Bush"],
  ["/prefabs/make/pine", 200, null, "Pine"],
  ["/prefabs/make/block-tree", 200, null, "Block tree"],
  ["/prefabs/make/house", 200, null, "House"],
  ["/prefabs/make/tower", 200, null, "Tower"],
  ["/prefabs/make/castle", 200, null, "Castle"],
  ["/prefabs/make/arrow", 200, null, "Arrow sign"],
  ["/prefabs/make/pixel-art", 200, null, "Pixel art"],
  ["/prefabs/make/stairs", 200, null, "Stairs"],
  ["/prefabs/make/bridge", 200, null, "Bridge"],
  ["/prefabs/make/floor-tiles", 200, null, "Floor tiles"],
  ["/prefabs/make/spiral", 200, null, "Spiral ramp"],
  ["/prefabs/make/loop", 200, null, "Loop"],
  ["/prefabs/make/jump", 200, null, "Jump"],
  ["/prefabs/make/plinko", 200, null, "Plinko board"],
  ["/prefabs/make/rollers", 200, null, "Rollers"],
  ["/prefabs/make/lamp", 200, null, "Lamp post"],
  ["/prefabs/make/fountain", 200, null, "Fountain"],
  ["/prefabs/make/trophy", 200, null, "Trophy"],
  ["/prefabs/make/fence", 200, null, "Fence"],
  ["/prefabs/make/finish-arch", 200, null, "Finish arch"],
  ["/prefabs/make/no-such-generator", 404],
  ["/prefabs/make/qr", 308, "/prefabs/make"],
  // the Generators' collage, for agents: a 404 only in production on Vercel
  ["/prefabs/collage?g=house", 200, null, "Generator collage"],
  ["/api/prefabs", 200, null, '"signedIn":false'],
  ["/robots.txt", 200, null, "Disallow: /prefabs/new"],
  ["/prefab/twin-cubes", 200, null, "Twin cubes"],
  [
    "/prefab/twin-cubes",
    200,
    null,
    '<link rel="canonical" href="' + ORIGIN + '/prefab/twin-cubes"',
  ],
  ["/prefab/cube-row", 200, null, "Newcomer"],
  ["/prefab/twin-cubes", 200, null, "/og/prefab/twin-cubes?v="],
  ["/og/prefab/twin-cubes", 200, null, "PNG"],
  ["/og/prefab/nope", 404],
  ["/prefab/nope", 200, null, "This prefab is gone"],
  ["/prefab/Not_A_Slug", 404],
  ["/prefab/twin-cubes/x", 404],
  ["/api/prefabs/twin-cubes/file", 200, null, "BallestPrefab"],
  ["/api/prefabs/nope/file", 404],
  ["/api/prefabs/twin-cubes/favorite", 200, null, '"favorites":0'],
  ["/api/prefabs/nope/favorite", 404],
  ["/api/prefabs/twin-cubes", 405],
  // the Stats Link's page (tiny's link request, signed out) and its confirm, which only POSTs
  ["/discord/link?t=5eed0000000000000000000000000001", 200, null, "rae.disc"],
  ["/discord/link?t=nope", 200, null, "This link doesn&#x27;t work"],
  ["/discord/link", 200, null, "See my stats"],
  ["/api/discord/link?t=nope", 405],
  ["/robots.txt", 200, null, "Disallow: /discord/"],
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

// Every page the app defines answers 200 on at least one route above, so a new kind of page
// gets seed data (tiny or stress) and a route here with the code that adds it, rather than
// being checked only by its 404s.
function appPages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? appPages(join(dir, e.name))
      : e.name === "page.tsx"
        ? [posix.relative(join(root, "web/app"), dir).split("/").filter(Boolean)]
        : [],
  );
}
/* a route group `(x)` or a parallel route `@x` adds no path segment */
const routeRegex = (segs) =>
  new RegExp(
    "^" +
      segs
        .filter((s) => !s.startsWith("(") && !s.startsWith("@"))
        .map((s) =>
          s.startsWith("[[...")
            ? "(/[^?]+)?"
            : s.startsWith("[...")
              ? "/[^?]+"
              : s.startsWith("[")
                ? "/[^/?]+"
                : "/" + s,
        )
        .join("") +
      "/?(\\?.*)?$",
  );
const served = ROUTES.filter(([, status, , text]) => status === 200 && text !== SOFT_404);
for (const segs of appPages(join(root, "web/app"))) {
  checked++;
  const re = routeRegex(segs);
  if (!served.some(([path]) => re.test(path)))
    failures.push(`/${segs.join("/")}: no route above answers it with a page`);
}

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
