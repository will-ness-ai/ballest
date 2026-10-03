// `pnpm sandbox`: a copy of the bot for agents to drive, in its own channel on the test server
// (made by `pnpm axi sandbox create`). It is the real bot on the dev app, with two swaps: the
// tests' fake Steam, so any Player can link and set times on demand, and the driver
// (scripts/sandbox/driver.ts), which clicks buttons as any member. A fresh database each start;
// log in .logs/sandbox.log. Drive it with `pnpm axi`.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { app } from "../src/app.js"
import { Steam } from "../src/ports.js"
import { makeFakeSteam, makeMap } from "../test/harness.js"
import { devEnvFile } from "./devEnv.js"
import { makeDriver } from "./sandbox/driver.js"
import { DRIVER_PORT, LOGS, readSandbox, SANDBOX_HTTP_PORT } from "./sandbox/config.js"

const sandbox = readSandbox()
if (sandbox === null) {
  console.log("error: no sandbox channel yet. Make one with: pnpm axi sandbox create")
  process.exit(1)
}

mkdirSync(LOGS, { recursive: true })
const db = join(LOGS, "sandbox.sqlite")
for (const f of [db, `${db}-shm`, `${db}-wal`]) if (existsSync(f)) rmSync(f)
process.env["LOG_FILE"] = join(LOGS, "sandbox.log")
writeFileSync(process.env["LOG_FILE"], "")
process.env["DB_PATH"] = db
process.env["DISCORD_CHANNEL_ID"] = sandbox.channelId
process.env["MULTIBALLS_SANDBOX"] = "true"
process.env["PORT"] = String(SANDBOX_HTTP_PORT)
process.env["MULTIBALLS_ENV"] = devEnvFile()

const MAPS = [
  makeMap(1, { title: "Pebble Ramp", creator: "pebblewright" }),
  makeMap(2, { title: "Spiral Sprint", creator: "marblequeen" }),
  makeMap(3, { title: "Nine Loops", creator: "rollo" })
]

const steam = Effect.runSync(makeFakeSteam({}))
Effect.runSync(steam.control.setCatalogue(MAPS))

/** Any profile resolves: `bob` or `https://steamcommunity.com/id/bob` is the fake account `fake-bob`. */
const AnyProfileSteam = Layer.succeed(
  Steam,
  Steam.of({
    ...steam.port,
    resolveProfile: (input) => {
      const name = input.replace(/\/+$/, "").split("/").at(-1) ?? input
      return Effect.succeed({ steamId: `fake-${name}`, personaName: name, avatarUrl: "", campaignTracks: 21, campaignTrackTotal: 23 })
    }
  })
)

const driver = makeDriver({ port: DRIVER_PORT, channelId: sandbox.channelId, steam: steam.control })

Layer.launch(app(AnyProfileSteam, driver)).pipe(NodeRuntime.runMain)
