// The Activity's web server: the page Discord shows in its iframe, the page's script (bundled
// from web/app.ts with the Embedded App SDK when the server starts), its fonts, the Map
// previews, and the API.
//
// Discord reaches it through the Activity's URL Mapping (`/` → this server's public host), so
// the page and the API share one origin and every path the page fetches is relative. Nothing
// loads from any other host: Discord's proxy blocks it. So the fonts come from the @fontsource
// packages, and each Map's Workshop preview is fetched here and passed on.
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { build } from "esbuild"
import { Clock, Config, Data, Effect, Layer, Option, Ref } from "effect"
import { Store } from "../ports.js"
import { makeActivityApi } from "./api.js"

const WEB = fileURLToPath(new URL("./web/", import.meta.url))
const require = createRequire(import.meta.url)

/** What the page needs before it can sign in. */
export interface PageConfig {
  /** The Discord application's id, for the SDK. */
  readonly clientId: string
  /** The Ballest server: opened anywhere else, the page says so. */
  readonly guildId: string
  /**
   * Members the page may sign in as without Discord, for trying it in a plain browser. Only the
   * demo sets these, with a DiscordAuth that accepts `dev-<id>` tokens; the real bot never does.
   */
  readonly devUsers: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

/** Every face the page uses (index.html's @font-face rules name the same files). */
const FACES: ReadonlyArray<readonly [string, ReadonlyArray<number>]> = [
  ["archivo", [400, 500, 600, 700, 800]],
  ["chakra-petch", [400, 500, 600, 700]],
  ["bungee", [400]],
  ["nunito", [800, 900]]
]

/** The page, its script or its fonts couldn't be read or built: the Activity can't start. */
export class ActivityUnavailable extends Data.TaggedError("ActivityUnavailable")<{ readonly what: string; readonly cause: unknown }> {}
/** Steam wouldn't give a Map's preview. */
class PreviewUnavailable extends Data.TaggedError("PreviewUnavailable")<{ readonly reason: string }> {}

const loadFonts = Effect.tryPromise({
  try: async () => {
    const fonts = new Map<string, Buffer>()
    for (const [pkg, weights] of FACES)
      for (const weight of weights) {
        const file = `${pkg}-latin-${weight}-normal.woff2`
        fonts.set(file, await readFile(require.resolve(`@fontsource/${pkg}/files/${file}`)))
      }
    return fonts
  },
  catch: (cause) => new ActivityUnavailable({ what: "fonts", cause })
})

const bundle = Effect.tryPromise({
  try: async () => {
    const result = await build({
      entryPoints: [`${WEB}app.ts`],
      bundle: true,
      format: "esm",
      target: "es2022",
      minify: true,
      write: false,
      logLevel: "silent"
    })
    const script = result.outputFiles[0]
    if (script === undefined) throw new Error("esbuild wrote nothing")
    return script.text
  },
  catch: (cause) => new ActivityUnavailable({ what: "script", cause })
})

const loadPage = Effect.tryPromise({
  try: () => readFile(`${WEB}index.html`, "utf8"),
  catch: (cause) => new ActivityUnavailable({ what: "page", cause })
})

/** Recent Map previews, so every viewer's page doesn't refetch them from Steam. */
const PREVIEWS_KEPT = 50
/** A preview Steam wouldn't give is asked for again after this long. */
const MISSING_RETRY_MS = 5 * 60_000

interface Image {
  readonly type: string
  readonly body: Uint8Array
}

const fetchImage = Effect.fn("fetchImage")(function* (url: string) {
  const response = yield* Effect.tryPromise({
    try: () => fetch(url, { signal: AbortSignal.timeout(5000) }),
    catch: (cause) => new PreviewUnavailable({ reason: String(cause) })
  })
  const type = response.headers.get("content-type") ?? ""
  if (!response.ok || !type.startsWith("image/")) return yield* new PreviewUnavailable({ reason: `${response.status} ${type}` })
  const body = yield* Effect.tryPromise({
    try: () => response.arrayBuffer(),
    catch: (cause) => new PreviewUnavailable({ reason: String(cause) })
  })
  const image: Image = { type, body: new Uint8Array(body) }
  return image
})

const DAY = "public, max-age=86400"

/** The whole app: page, script, fonts, previews, config, API. `channelId` is where the links point. */
export const makeActivityApp = Effect.fn("makeActivityApp")(function* (config: PageConfig & { readonly channelId: string }) {
  const { channelId, ...page } = config
  const api = yield* makeActivityApi({ guildId: config.guildId, channelId })
  const store = yield* Store
  const script = yield* bundle
  const html = yield* loadPage
  const fonts = yield* loadFonts
  /** Each preview, or null (with when it went missing) for one Steam wouldn't give. */
  const previews = yield* Ref.make(new Map<string, { readonly image: Image | null; readonly at: number }>())

  /** Steam's preview for this URL: kept, or fetched now. A missing one is tried again after a while. */
  const imageOf = Effect.fn("imageOf")(function* (id: string, url: string) {
    const now = yield* Clock.currentTimeMillis
    const known = (yield* Ref.get(previews)).get(url)
    if (known !== undefined && (known.image !== null || now - known.at < MISSING_RETRY_MS)) return known.image
    const image = yield* fetchImage(url).pipe(
      Effect.tapError((e) => Effect.logWarning(`activity: no preview for ${id} (${e.reason})`)),
      Effect.option,
      Effect.map((found) => Option.getOrNull(found))
    )
    yield* Ref.update(previews, (m) => {
      const next = new Map(m).set(url, { image, at: now })
      for (const key of next.keys()) if (next.size > PREVIEWS_KEPT) next.delete(key)
      return next
    })
    return image
  })

  /** A Match's Map preview, only for a Match the bot has drawn a Map for: this is no open proxy. */
  const preview = Effect.gen(function* () {
    const { id = "" } = yield* HttpRouter.params
    const url = Option.flatMap(yield* store.getMatch(id), (m) => Option.fromNullable(m.map?.previewUrl || null))
    if (Option.isNone(url)) return HttpServerResponse.empty({ status: 404 })
    const image = yield* imageOf(id, url.value)
    // A missing preview is remembered by the browser for a while too, so redraws don't ask again.
    if (image === null) return HttpServerResponse.empty({ status: 404, headers: { "cache-control": "public, max-age=300" } })
    return HttpServerResponse.uint8Array(image.body, { contentType: image.type, headers: { "cache-control": DAY } })
  })

  const font = Effect.gen(function* () {
    const { file = "" } = yield* HttpRouter.params
    const body = fonts.get(file)
    return body === undefined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.uint8Array(body, { contentType: "font/woff2", headers: { "cache-control": DAY } })
  })

  const pages = HttpRouter.empty.pipe(
    HttpRouter.get("/", Effect.succeed(HttpServerResponse.html(html))),
    HttpRouter.get("/app.js", Effect.succeed(HttpServerResponse.text(script, { contentType: "text/javascript" }))),
    HttpRouter.get("/fonts/:file", font),
    HttpRouter.get("/previews/:id", preview),
    HttpRouter.get("/api/config", Effect.succeed(HttpServerResponse.unsafeJson(page)))
  )
  return pages.pipe(Effect.catchTag("RouteNotFound", () => api))
})

/** Serve the Activity on PORT. Needs the Engine, the Store, where Cards are, and Discord's sign-in and members. */
export const activityServer = (config: PageConfig & { readonly channelId: string }) =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const port = yield* Config.integer("PORT").pipe(Config.withDefault(8080))
      const app = yield* makeActivityApp(config)
      yield* Effect.log(`activity: serving on port ${port}`)
      return HttpServer.serve(app).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
    })
  )
