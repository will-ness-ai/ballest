// Steam Web API calls (plain HTTPS with the API key), plus the campaign board list from our
// own site, so the bot never keeps a second copy of tools/campaign_common.py's board table.
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { Config, Effect, Option, Redacted, Schedule, Schema } from "effect"
import type { MapInfo } from "../domain.js"
import { SteamUnavailable } from "../ports.js"
import { APP_ID } from "./session.js"

const PAGE_SIZE = 100
const SUMMARIES_PER_CALL = 100

const QueryFilesPage = Schema.Struct({
  response: Schema.Struct({
    next_cursor: Schema.optional(Schema.String),
    publishedfiledetails: Schema.optionalWith(
      Schema.Array(
        Schema.Struct({
          publishedfileid: Schema.String,
          title: Schema.optionalWith(Schema.String, { default: () => "" }),
          creator: Schema.String,
          preview_url: Schema.optionalWith(Schema.String, { default: () => "" }),
          metadata: Schema.optionalWith(Schema.String, { default: () => "" })
        })
      ),
      { default: () => [] }
    )
  })
})

/** The game writes each Map's board name and Medal times into its Workshop metadata. */
const BallestMetadata = Schema.parseJson(
  Schema.Struct({
    ballest: Schema.Struct({
      leaderboard_name_current: Schema.String,
      medal_times_by_index: Schema.Tuple(Schema.Number, Schema.Number, Schema.Number, Schema.Number)
    })
  })
)
const decodeMetadata = Schema.decodeUnknownOption(BallestMetadata)

const Summaries = Schema.Struct({
  response: Schema.Struct({
    players: Schema.Array(
      Schema.Struct({
        steamid: Schema.String,
        personaname: Schema.String,
        avatarfull: Schema.optionalWith(Schema.String, { default: () => "" })
      })
    )
  })
})
export type Summary = (typeof Summaries.Type)["response"]["players"][number]

const Vanity = Schema.Struct({
  response: Schema.Struct({ success: Schema.Number, steamid: Schema.optional(Schema.String) })
})

const SiteIndex = Schema.Struct({
  // handle is null for the one board Steam doesn't have (the derived all-seasons Overall)
  boards: Schema.Array(Schema.Struct({ name: Schema.String, handle: Schema.NullOr(Schema.String) }))
})

export class WebApi extends Effect.Service<WebApi>()("multiballs/WebApi", {
  effect: Effect.gen(function* () {
    const key = yield* Config.redacted("STEAM_API_KEY")
    const site = yield* Config.string("SITE_URL").pipe(Config.withDefault("https://ballest.willness.dev"))
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ schedule: Schedule.exponential("500 millis"), times: 3 })
    )
    const getJson = <A, I>(url: string, params: Record<string, string>, schema: Schema.Schema<A, I>) =>
      http.execute(HttpClientRequest.get(url, { urlParams: params })).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        Effect.scoped,
        Effect.mapError((e) => new SteamUnavailable({ reason: `${new URL(url).pathname}: ${e._tag}` }))
      )
    const steamApi = <A, I>(path: string, params: Record<string, string>, schema: Schema.Schema<A, I>) =>
      getJson(`https://api.steampowered.com${path}`, { key: Redacted.value(key), ...params }, schema)

    const summaries = Effect.fn("WebApi.summaries")(function* (steamIds: ReadonlyArray<string>) {
      const out: Array<Summary> = []
      for (let i = 0; i < steamIds.length; i += SUMMARIES_PER_CALL) {
        const body = yield* steamApi(
          "/ISteamUser/GetPlayerSummaries/v2/",
          { steamids: steamIds.slice(i, i + SUMMARIES_PER_CALL).join(",") },
          Summaries
        )
        out.push(...body.response.players)
      }
      return out
    })

    return {
      /** Every published Workshop Map with usable Ballest metadata, creators named. */
      workshopMaps: Effect.fn("WebApi.workshopMaps")(function* () {
        const files: Array<(typeof QueryFilesPage.Type)["response"]["publishedfiledetails"][number]> = []
        const seen = new Set<string>()
        let cursor = "*"
        while (true) {
          const page = yield* steamApi(
            "/IPublishedFileService/QueryFiles/v1/",
            { appid: String(APP_ID), query_type: "1", numperpage: String(PAGE_SIZE), cursor, return_metadata: "1" },
            QueryFilesPage
          )
          const batch = page.response.publishedfiledetails
          for (const f of batch) {
            if (seen.has(f.publishedfileid)) continue
            seen.add(f.publishedfileid)
            files.push(f)
          }
          const next = page.response.next_cursor
          if (batch.length === 0 || next === undefined || next === cursor) break
          cursor = next
        }
        const creators = new Map(
          (yield* summaries([...new Set(files.map((f) => f.creator))])).map((s) => [s.steamid, s.personaname])
        )
        return files.flatMap((f): Array<MapInfo> =>
          Option.match(decodeMetadata(f.metadata), {
            onNone: () => [],
            onSome: ({ ballest }) => {
              const [bronze, silver, gold, author] = ballest.medal_times_by_index
              return [
                {
                  pfid: f.publishedfileid,
                  title: f.title,
                  creator: creators.get(f.creator) ?? "",
                  previewUrl: f.preview_url,
                  boardName: ballest.leaderboard_name_current,
                  medals: { bronze, silver, gold, author }
                }
              ]
            }
          })
        )
      }),

      /** A custom URL name to a SteamID64, or None. */
      resolveVanity: Effect.fn("WebApi.resolveVanity")(function* (name: string) {
        const body = yield* steamApi("/ISteamUser/ResolveVanityURL/v1/", { vanityurl: name }, Vanity)
        return body.response.success === 1 ? Option.fromNullable(body.response.steamid) : Option.none<string>()
      }),

      summaries,

      /** The campaign Track boards' ids, as the leaderboard site currently lists them. */
      campaignBoardIds: Effect.fn("WebApi.campaignBoardIds")(function* () {
        const index = yield* getJson(`${site}/data/index.json`, {}, SiteIndex)
        return index.boards.flatMap((b) => (b.name.startsWith("Map_") && b.handle !== null ? [Number(b.handle)] : []))
      })
    } as const
  }),
  dependencies: [FetchHttpClient.layer]
}) {}
