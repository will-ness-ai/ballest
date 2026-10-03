// Lobby pings (spec #87): the @Multiplayer ping role a member can give themselves, so a Lobby's
// Card pings them when it opens. Both surfaces, the channel's Pings reply and the Activity's
// bell, go through these few operations, so they always agree. The words are in pingWords.ts.
import { Effect } from "effect"
import { PingRole, Store } from "./ports.js"

export class Pings extends Effect.Service<Pings>()("multiballs/Pings", {
  effect: Effect.gen(function* () {
    const role = yield* PingRole
    const store = yield* Store

    /** Whether the member has the role, read from Discord each time (never cached). */
    const status = (discordId: string) => role.has(discordId)

    return {
      status,
      /** Add or remove the role. Choosing either way answers the offer too. */
      set: Effect.fn("Pings.set")(function* (discordId: string, on: boolean) {
        yield* on ? role.add(discordId) : role.remove(discordId)
        yield* store.answerPingOffer(discordId)
      }),
      /**
       * Whether to offer the role, after a Join or Accept: only to a member who has never
       * answered the offer and doesn't have the role. Dismissing the offer isn't an answer.
       */
      offerFor: Effect.fn("Pings.offerFor")(function* (discordId: string) {
        if (yield* store.hasAnsweredPingOffer(discordId)) return false
        return !(yield* status(discordId))
      }),
      /** The member said No to the offer: never make it again. */
      decline: (discordId: string) => store.answerPingOffer(discordId)
    } as const
  })
}) {}
