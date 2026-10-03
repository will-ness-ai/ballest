// Lobby pings (spec #87): the @Multiplayer ping role a member can give themselves, so a Lobby's
// Card pings them when it opens. Both surfaces, the channel's Pings reply and the Activity's
// bell, go through these few operations, so they always agree. The words are in pingWords.ts.
import { Effect } from "effect";
import type { Action } from "./domain.js";
import { PingRole, type PingRoleUnavailable, Store } from "./ports.js";

/** Discord wouldn't read or change the role: one warning line, the same from both surfaces. */
export const warnPingRole = Effect.fn("warnPingRole")(function* (e: PingRoleUnavailable) {
  yield* Effect.logWarning(`ping role: ${e.reason}`);
});

/** The actions after which the role is offered: the ones that put a member in a Match. */
const OFFERED_AFTER: ReadonlySet<Action> = new Set<Action>(["join", "accept"]);

export class Pings extends Effect.Service<Pings>()("multiballs/Pings", {
  effect: Effect.gen(function* () {
    const role = yield* PingRole;
    const store = yield* Store;

    /** Whether the member has the role, read from Discord each time (never cached). */
    const status = Effect.fn("Pings.status")(function* (discordId: string) {
      return yield* role.has(discordId);
    });

    /**
     * Whether to offer the role: only to a member who has never answered the offer and doesn't
     * have the role. Dismissing the offer isn't an answer.
     */
    const offerFor = Effect.fn("Pings.offerFor")(function* (discordId: string) {
      if (yield* store.hasAnsweredPingOffer(discordId)) return false;
      return !(yield* status(discordId));
    });

    return {
      status,
      /** Add or remove the role. Choosing either way answers the offer too. */
      set: Effect.fn("Pings.set")(function* (discordId: string, on: boolean) {
        yield* on ? role.add(discordId) : role.remove(discordId);
        yield* store.answerPingOffer(discordId);
      }),
      /**
       * Whether to offer the role after `action` went through: only after a Join or Accept, to a
       * member who is due it (`offerFor`). The action stands either way, so if Discord can't say
       * whether they have the role, the offer waits for a later Join.
       */
      offerAfter: Effect.fn("Pings.offerAfter")(function* (action: Action, discordId: string) {
        if (!OFFERED_AFTER.has(action)) return false;
        return yield* offerFor(discordId).pipe(
          Effect.catchTag("PingRoleUnavailable", (e) => warnPingRole(e).pipe(Effect.as(false))),
        );
      }),
      /** The member said No to the offer: never make it again. */
      decline: Effect.fn("Pings.decline")(function* (discordId: string) {
        yield* store.answerPingOffer(discordId);
      }),
    } as const;
  }),
}) {}
