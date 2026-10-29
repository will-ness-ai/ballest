// The Activity's web server: the page Discord shows in its iframe, the page's script (bundled
// from web/main.tsx with React and the Embedded App SDK when the server starts), its fonts, the
// Map previews, and the API. The page arrives with its config and the signing-in screen already
// in it, and names the script by its hash, so a browser keeps the script until a deploy changes it.
//
// Discord reaches it through the Activity's URL Mapping (`/` → this server's public host), so
// the page and the API share one origin and every path the page fetches is relative. Nothing
// loads from any other host: Discord's proxy blocks it. So the fonts come from the @fontsource
// packages, each Map's Workshop preview is fetched here and passed on, and each Skin's picture
// (for a Player's Chosen Skin) is the bot's own copy, from SkinPictures.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { build } from "esbuild";
import { Config, Data, Effect, Layer, Option } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Store } from "../ports.js";
import { MapPreviews } from "../previews.js";
import { skinPictureFile } from "../render/skinList.js";
import { SkinPictures } from "../render/skins.js";
import { type ActivityVenue, makeActivityApi } from "./api.js";
import { SigningIn } from "./web/ui/notice.js";

const WEB = fileURLToPath(new URL("./web/", import.meta.url));
const require = createRequire(import.meta.url);

/** What the page needs before it can sign in. */
export interface PageConfig {
  /** The Discord application's id, for the SDK. */
  readonly clientId: string;
  /** Each running Venue's server: opened anywhere else, the page says so. */
  readonly guildIds: ReadonlyArray<string>;
  /**
   * Members the page may sign in as without Discord, for trying it in a plain browser. Only the
   * demo sets these, with a DiscordAuth that accepts `dev-<id>` tokens; the real bot never does.
   */
  readonly devUsers: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

/** Every face the page uses (index.html's @font-face rules name the same files). */
const FACES: ReadonlyArray<readonly [string, ReadonlyArray<number>]> = [
  ["archivo", [400, 500, 600, 700, 800]],
  ["chakra-petch", [400, 500, 600, 700]],
  ["bungee", [400]],
  ["nunito", [800, 900]],
];

/** The page, its script or its fonts couldn't be read or built: the Activity can't start. */
export class ActivityUnavailable extends Data.TaggedError("ActivityUnavailable")<{
  readonly what: string;
  readonly cause: unknown;
}> {}

const loadFonts = Effect.tryPromise({
  try: async () => {
    const fonts = new Map<string, Buffer>();
    for (const [pkg, weights] of FACES)
      for (const weight of weights) {
        const file = `${pkg}-latin-${weight}-normal.woff2`;
        fonts.set(file, await readFile(require.resolve(`@fontsource/${pkg}/files/${file}`)));
      }
    return fonts;
  },
  catch: (cause) => new ActivityUnavailable({ what: "fonts", cause }),
});

const bundle = Effect.tryPromise({
  try: async () => {
    const result = await build({
      entryPoints: [`${WEB}main.tsx`],
      bundle: true,
      format: "esm",
      target: "es2022",
      jsx: "automatic",
      // React's production build
      define: { "process.env.NODE_ENV": '"production"' },
      minify: true,
      write: false,
      logLevel: "silent",
    });
    const script = result.outputFiles[0];
    if (script === undefined) throw new Error("esbuild wrote nothing");
    return script.text;
  },
  catch: (cause) => new ActivityUnavailable({ what: "script", cause }),
});

const loadPage = Effect.tryPromise({
  try: () => readFile(`${WEB}index.html`, "utf8"),
  catch: (cause) => new ActivityUnavailable({ what: "page", cause }),
});

const DAY = "public, max-age=86400";
/** The script's URL carries its hash, so it never changes under a browser that kept it. */
const FOREVER = "public, max-age=31536000, immutable";

/** The script's version: its hash, which the page names it by. */
const versionOf = (script: string) =>
  createHash("sha256").update(script).digest("hex").slice(0, 12);

/** The encodings a browser takes, from its Accept-Encoding; one it gives q=0 it refuses. */
const accepted = (acceptEncoding: string) =>
  acceptEncoding.split(",").flatMap((part) => {
    const [name = "", ...params] = part.split(";").map((p) => p.trim());
    const refused = params.some((p) => /^q=0(\.0*)?$/.test(p));
    return name === "" || refused ? [] : [name];
  });

/**
 * The script, compressed once at start for each encoding a browser may take (React and the SDK
 * make it about 460 KB as is, a quarter of that compressed); the plain one for any other. Kept
 * for good only when asked for by this script's version: a page from before a deploy gets this
 * script uncached rather than cached under its old name.
 */
export const scriptResponses = (script: string) => {
  const plain = Buffer.from(script);
  const version = versionOf(script);
  const encoded = [
    // Quality 9 compresses nearly as well as the default 11 in a fraction of the time.
    ["br", brotliCompressSync(plain, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })],
    ["gzip", gzipSync(plain)],
  ] as const;
  return (acceptEncoding: string, asked: string): HttpServerResponse.HttpServerResponse => {
    const takes = accepted(acceptEncoding);
    const pick = encoded.find(([name]) => takes.includes(name));
    return HttpServerResponse.uint8Array(pick?.[1] ?? plain, {
      contentType: "text/javascript",
      headers: {
        "cache-control": asked === version ? FOREVER : "no-cache",
        vary: "accept-encoding",
        ...(pick === undefined ? {} : { "content-encoding": pick[0] }),
      },
    });
  };
};

/**
 * The page as served: the script named by its version, the config the page would otherwise ask
 * for, and the signing-in screen, so something shows before the script has run.
 */
export const servedPage = (html: string, script: string, config: PageConfig) => {
  // `<` escaped, so nothing in the config can end the script element.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  // Replacer functions, so a `$` in what goes in is never read as a replacement pattern.
  return html
    .replace(
      "<!--script-->",
      () => `<script type="module" src="/app.js?v=${versionOf(script)}"></script>`,
    )
    .replace("<!--config-->", () => `<script id="config" type="application/json">${json}</script>`)
    .replace("<!--splash-->", () => renderToStaticMarkup(createElement(SigningIn)));
};

/**
 * Each Skin's picture by the file the page asks for at /skins/:file (skinPictureFile, from a
 * Player's Chosen Skin), and 404 for any other file.
 */
export const skinPictureResponses = (pngs: ReadonlyMap<string, Uint8Array>) => {
  const byFile = new Map(
    [...pngs].flatMap(([path, png]) => {
      const file = skinPictureFile(path);
      return file === null ? [] : [[file, png] as const];
    }),
  );
  return (file: string): HttpServerResponse.HttpServerResponse => {
    const body = byFile.get(file);
    return body === undefined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.uint8Array(body, {
          contentType: "image/png",
          headers: { "cache-control": DAY },
        });
  };
};

/**
 * What the Activity is started with: the running Venues, read at each request, and the page's
 * other settings.
 */
export type ActivityConfig = Omit<PageConfig, "guildIds"> & {
  readonly venues: Effect.Effect<ReadonlyArray<ActivityVenue>>;
};

/** The whole app: page, script, fonts, previews, Skin pictures, config, API. */
export const makeActivityApp = Effect.fn("ActivityApp.make")(function* (config: ActivityConfig) {
  const { venues, ...rest } = config;
  const api = yield* makeActivityApi(venues);
  const store = yield* Store;
  const previews = yield* MapPreviews;
  const script = yield* bundle;
  const html = yield* loadPage;
  /** The config as of now: the Venues on offer change while the bot runs (a guest coming up). */
  const pageConfig = Effect.map(venues, (now): PageConfig => ({
    ...rest,
    guildIds: now.map((v) => v.guildId),
  }));
  const scriptFor = scriptResponses(script);
  const fonts = yield* loadFonts;
  /** A Match's Map preview, only for a Match the bot has drawn a Map for: this is no open proxy. */
  const preview = Effect.gen(function* () {
    const { id = "" } = yield* HttpRouter.params;
    const m = yield* store.getMatch(id);
    const found =
      Option.isSome(m) && m.value.map !== null
        ? yield* previews.of(m.value.map.previewUrl)
        : Option.none();
    // A missing preview is remembered by the browser for a while too, so redraws don't ask again.
    if (Option.isNone(found))
      return HttpServerResponse.empty({
        status: 404,
        headers: { "cache-control": "public, max-age=300" },
      });
    return HttpServerResponse.uint8Array(found.value.body, {
      contentType: found.value.type,
      headers: { "cache-control": DAY },
    });
  });

  const font = Effect.gen(function* () {
    const { file = "" } = yield* HttpRouter.params;
    const body = fonts.get(file);
    return body === undefined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.uint8Array(body, {
          contentType: "font/woff2",
          headers: { "cache-control": DAY },
        });
  });

  const skinPicture = skinPictureResponses((yield* SkinPictures).pngs);
  const skin = Effect.map(HttpRouter.params, ({ file = "" }) => skinPicture(file));

  const pages = HttpRouter.empty.pipe(
    HttpRouter.get(
      "/",
      Effect.map(pageConfig, (page) =>
        HttpServerResponse.text(servedPage(html, script, page), {
          contentType: "text/html",
          headers: { "cache-control": "no-cache" },
        }),
      ),
    ),
    HttpRouter.get(
      "/app.js",
      Effect.map(HttpServerRequest.HttpServerRequest, (req) =>
        scriptFor(
          req.headers["accept-encoding"] ?? "",
          new URL(req.url, "http://page").searchParams.get("v") ?? "",
        ),
      ),
    ),
    HttpRouter.get("/fonts/:file", font),
    HttpRouter.get("/previews/:id", preview),
    HttpRouter.get("/skins/:file", skin),
    HttpRouter.get(
      "/api/config",
      Effect.map(pageConfig, (page) => HttpServerResponse.unsafeJson(page)),
    ),
  );
  return pages.pipe(Effect.catchTag("RouteNotFound", () => api));
});

/** Serve the Activity on PORT. Needs the Engine, the Store, Lobby pings, Chosen Skins and their pictures, where Cards are, and Discord's sign-in and members. */
export const activityServer = (config: ActivityConfig) =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const port = yield* Config.integer("PORT").pipe(Config.withDefault(8080));
      const app = yield* makeActivityApp(config);
      yield* Effect.log(`activity: serving on port ${port}`);
      return HttpServer.serve(app).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
      );
    }),
  );
