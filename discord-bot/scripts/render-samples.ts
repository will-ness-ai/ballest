// `pnpm render:samples [dir]`: renders every image the bot draws, in every state, as PNGs to
// check by eye against the prototype (branch claude/prototype-discord-bot-surfaces).
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import type { Player, Standing } from "../src/domain.js"
import type { CardView } from "../src/ports.js"
import { Renderer } from "../src/render/renderer.js"

const out = process.argv[2] ?? "render-samples"
const T = 100_000
const p = (name: string): Player => ({ discordId: name, steamId: `7656119800${name.length}${name.charCodeAt(0)}${name.charCodeAt(1)}` })
const [chkn, tilt, grav, maxx] = [p("ChknThugget"), p("tilt_queen"), p("gravwell"), p("marblemaxxer")] as const
const names = new Map([chkn, tilt, grav, maxx].map((x) => [x.discordId, x.discordId]))
const map = {
  pfid: "3791550212",
  title: "Gutter Run",
  creator: "pebblewright",
  previewUrl: "",
  boardName: "",
  medals: { bronze: 20, silver: 17, gold: 15.5, author: 14.2 },
  boardId: 1,
  worldRecordTicks: 12.981 * T
}
const standing = (player: Player, seconds: number | null, rank: number | null, medal: Standing["medal"]): Standing => ({
  player,
  ticks: seconds === null ? null : Math.round(seconds * T),
  rank,
  medal
})
const base: CardView = {
  matchId: "1",
  state: "invite",
  type: "lobby",
  minutes: 15,
  creator: chkn,
  target: null,
  players: [chkn, tilt, grav],
  map: null,
  standings: [],
  expiresAt: null,
  endsAt: null
}
const cards: Record<string, CardView> = {
  "card-invite-lobby": base,
  "card-invite-public": { ...base, type: "public", players: [chkn] },
  "card-invite-challenge": { ...base, type: "challenge", players: [chkn], target: tilt },
  "card-live-lobby": {
    ...base,
    state: "live",
    players: [chkn, tilt, grav, maxx],
    map,
    standings: [standing(grav, 14.59, 1, "gold"), standing(chkn, 15.118, 2, "gold"), standing(tilt, 16.402, 3, "silver"), standing(maxx, null, null, null)]
  },
  "card-final-lobby": {
    ...base,
    state: "finished",
    players: [chkn, tilt, grav, maxx],
    map,
    standings: [standing(grav, 13.977, 1, "author"), standing(chkn, 14.861, 2, "gold"), standing(tilt, 16.402, 3, "silver"), standing(maxx, null, null, null)]
  }
}

const program = Effect.gen(function* () {
  const renderer = yield* Renderer
  yield* Effect.promise(() => mkdir(out, { recursive: true }))
  const save = (name: string, png: Buffer) => Effect.promise(() => writeFile(join(out, `${name}.png`), png))
  for (const [name, view] of Object.entries(cards)) yield* save(name, yield* renderer.card({ view, names, preview: null }))
  yield* save(
    "row-lead",
    yield* renderer.improvement({ player: grav, ticks: 14.59 * T, medal: "gold", rank: 1, previousTicks: 17.244 * T, previousRank: 2 }, "gravwell")
  )
  yield* save("row-first", yield* renderer.improvement({ player: tilt, ticks: 16.402 * T, medal: "silver", rank: 2, previousTicks: null, previousRank: null }, "tilt_queen"))
  yield* save("footer", yield* renderer.footer)
  yield* save("link", yield* renderer.link({ steamId: "76561198012345678", personaName: "ChknThugget", avatarUrl: "", campaignTracks: 21, campaignTrackTotal: 23 }))
  yield* save("marble", yield* renderer.marble(96))
  yield* Effect.log(`wrote samples to ${out}`)
})

Effect.runPromise(program.pipe(Effect.provide(Renderer.Default)))
