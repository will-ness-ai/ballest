// The Renderer through its interface. Drawing is checked by eye (`pnpm render:samples`); what a
// test can hold it to is that every image it draws is let go. A Card redraws each time a time
// lands, so memory kept per draw adds up until the machine runs out: it once took production down.
import { performance } from "node:perf_hooks"
import { setFlagsFromString } from "node:v8"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { Renderer } from "../src/render/renderer.js"
import { ALICE, BOB, cardView, drawnMap, ticks } from "./harness.js"

setFlagsFromString("--expose-gc")
const gc = runInNewContext("gc") as () => void

/** The process's resident memory after a full collection, in MB. */
const resident = () => {
  gc()
  return process.memoryUsage().rss / 1048576
}

const live = cardView("m1", {
  state: "live",
  type: "lobby",
  players: [ALICE, BOB],
  map: drawnMap(),
  standings: [
    { player: ALICE, ticks: ticks(19), rank: 1, medal: "author" },
    { player: BOB, ticks: ticks(24), rank: 2, medal: "gold" }
  ]
})
const names = new Map([
  [ALICE.discordId, "Alice"],
  [BOB.discordId, "Bob"]
])

describe("the Renderer", () => {
  it.effect(
    "lets go of every image it draws",
    () =>
      Effect.gen(function* () {
        const renderer = yield* Renderer
        // Warm up: fonts, layout and the rasteriser's own buffers settle first.
        for (let i = 0; i < 5; i++) yield* renderer.card({ view: live, names, preview: null })
        const before = resident()
        // Each live Card is about 3 MB of pixels; kept, 40 of them would be over 100 MB.
        for (let i = 0; i < 40; i++) yield* renderer.card({ view: live, names, preview: null })
        expect(resident() - before).toBeLessThan(40)
      }).pipe(Effect.provide(Renderer.Default)),
    60_000
  )

  it.effect(
    "keeps the bot answering while it draws",
    () =>
      Effect.gen(function* () {
        const renderer = yield* Renderer
        yield* renderer.card({ view: live, names, preview: null })
        // A draw takes about a second; a 10 ms timer set while it runs must still fire on time.
        const drawing = yield* Effect.fork(renderer.card({ view: live, names, preview: null }))
        const late = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const start = performance.now()
              setTimeout(() => resolve(performance.now() - start - 10), 10)
            })
        )
        yield* Fiber.join(drawing)
        expect(late).toBeLessThan(300)
      }).pipe(Effect.provide(Renderer.Default)),
    60_000
  )
})
