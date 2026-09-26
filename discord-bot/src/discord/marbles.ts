// The small marbles that start each lifecycle line in a Match Thread. Discord can't colour an
// emoji per Player, so the application carries one marble emoji per hue step; a Player gets
// the step nearest their own hue. Missing steps are uploaded at startup, once.
import { Effect } from "effect"
import { hueFor } from "../render/art.js"
import { Renderer } from "../render/renderer.js"
import { Discord, describeDiscordError, oneLine } from "./client.js"

const STEP = 15
const HUES = Array.from({ length: 360 / STEP }, (_, i) => i * STEP)
const nameOf = (hue: number) => `marble_${String(hue).padStart(3, "0")}`

export interface MarbleEmojis {
  /** The emoji nearest a hue, or nothing if Discord wouldn't take them. */
  readonly forHue: (hue: number) => string
  /** A Player's marble, the same colour as on the Card and the site. */
  readonly forPlayer: (steamId: string) => string
}

const NONE: MarbleEmojis = { forHue: () => "", forPlayer: () => "" }

export class Marbles extends Effect.Service<Marbles>()("multiballs/Marbles", {
  effect: Effect.gen(function* () {
    const discord = yield* Discord
    const renderer = yield* Renderer

    const ids = new Map(yield* discord.appEmojis)
    // A step Discord won't take is skipped: its Players' lines go without a marble.
    for (const hue of HUES) {
      const name = nameOf(hue)
      if (ids.has(name)) continue
      yield* renderer.marble(hue).pipe(
        Effect.flatMap((png) => discord.createAppEmoji(name, png)),
        Effect.tap((id) => Effect.sync(() => ids.set(name, id))),
        Effect.catchAll((e) => Effect.logWarning(`marble emoji ${name} unavailable: ${e._tag === "DiscordError" ? describeDiscordError(e) : oneLine(e.cause)}`))
      )
    }
    yield* Effect.log(`marble emojis ready (${[...ids.keys()].filter((n) => n.startsWith("marble_")).length} of ${HUES.length})`)

    const forHue = (hue: number) => {
      const nearest = (Math.round(hue / STEP) * STEP) % 360
      const id = ids.get(nameOf(nearest))
      return id === undefined ? "" : `<:${nameOf(nearest)}:${id}>`
    }
    const emojis: MarbleEmojis = { forHue, forPlayer: (steamId) => forHue(hueFor(steamId)) }
    return emojis
  }).pipe(
    Effect.catchAll((e) =>
      Effect.logWarning(`marble emojis unavailable (${describeDiscordError(e)}); lifecycle lines go without them`).pipe(
        Effect.as(NONE)
      )
    )
  )
}) {}
