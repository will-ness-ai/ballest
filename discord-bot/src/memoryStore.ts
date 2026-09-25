// An in-memory Store. Tests use it; the SQLite Store replaces it in the running bot.
import { Effect, Layer, Option, Ref } from "effect"
import type { Link, Match } from "./domain.js"
import { Store } from "./ports.js"

export const makeMemoryStore = Effect.gen(function* () {
  const links = yield* Ref.make(new Map<string, Link>())
  const matches = yield* Ref.make(new Map<string, Match>())
  const counter = yield* Ref.make(0)
  return Store.of({
    getLink: (discordId) => Ref.get(links).pipe(Effect.map((m) => Option.fromNullable(m.get(discordId)))),
    putLink: (link) => Ref.update(links, (m) => new Map(m).set(link.discordId, link)),
    nextMatchId: Ref.updateAndGet(counter, (n) => n + 1).pipe(Effect.map((n) => `m${n}`)),
    getMatch: (id) => Ref.get(matches).pipe(Effect.map((m) => Option.fromNullable(m.get(id)))),
    putMatch: (match) => Ref.update(matches, (m) => new Map(m).set(match.id, match)),
    deleteMatch: (id) =>
      Ref.update(matches, (m) => {
        const next = new Map(m)
        next.delete(id)
        return next
      }),
    activeMatches: Ref.get(matches).pipe(Effect.map((m) => [...m.values()].filter((x) => x.state !== "finished")))
  })
})

export const MemoryStoreLive = Layer.effect(Store, makeMemoryStore)
