// Live smoke run of the Steam adapter against real Steam (the adapter's only test; the
// engine's tests use a fake). Reads secrets from discord-bot/.env in the main checkout.
//   pnpm smoke:steam
import { SqliteClient } from "@effect/sql-sqlite-node"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { authorTimeFits, seconds } from "../src/domain.js"
import { Steam } from "../src/ports.js"
import { SteamLive } from "../src/steam/steamLive.js"

const mainCheckout = dirname(execSync("git rev-parse --path-format=absolute --git-common-dir").toString().trim())
const envFile = process.env["MULTIBALLS_ENV"] ?? join(mainCheckout, "discord-bot", ".env")
const env = new Map(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l): [string, string] => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
)

const MAIN = "76561198047685844" // has campaign times
const BOT = "76561198637918262" // the bot's own account: no times anywhere
const MAP_TRACK13 = 17800617

const timed = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const t0 = Date.now()
    const a = yield* effect
    console.log(`${label}  (${Date.now() - t0} ms)`)
    return a
  })

const program = Effect.gen(function* () {
  const steam = yield* Steam
  const maps = yield* timed("catalogue", steam.catalogue)
  console.log(`  ${maps.length} Workshop Maps`)
  yield* timed("catalogue again (cached)", steam.catalogue)

  const candidate = maps.find((m) => authorTimeFits(m, 15))
  if (candidate === undefined) return yield* Effect.die("no Map fits 15 minutes")
  const c1 = yield* timed(`check "${candidate.title}"`, steam.check(candidate, [MAIN, BOT]))
  console.log(`  board ${c1.boardId}, WR ${c1.worldRecordTicks === null ? "-" : seconds(c1.worldRecordTicks) + " s"}, played by [${c1.playedBy}]`)
  yield* timed("check again (board id cached)", steam.check(candidate, [MAIN, BOT]))

  const e = yield* timed("readPlayers Map_Track13", steam.readPlayers(MAP_TRACK13, [MAIN, BOT]))
  console.log(`  ${e.map((x) => `${x.steamId}: ${seconds(x.ticks)} s`).join(", ")}  (the bot account should be absent)`)

  const p = yield* timed("resolveProfile /id/ChknThugget", steam.resolveProfile("https://steamcommunity.com/id/ChknThugget/"))
  console.log(`  ${p.personaName} ${p.steamId}, times on ${p.campaignTracks} campaign Tracks`)
  const bad = yield* Effect.flip(steam.resolveProfile("nonexistentvanity-zzqq9"))
  console.log(`resolveProfile unknown → ${bad._tag}`)
  return Option.none()
})

const layer = SteamLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" })))
Effect.runPromise(
  program.pipe(
    Effect.provide(layer),
    Effect.withConfigProvider(ConfigProvider.fromMap(env))
  )
).then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
