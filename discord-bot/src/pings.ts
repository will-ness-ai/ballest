// Lobby pings (spec #87): the @Multiplayer ping role a member can give themselves, so a Lobby's
// Card pings them when it opens. Each Venue has its own role, offered and answered there
// (spec #315). Both surfaces, the channel's Pings reply and the Activity's bell, go through these
// few operations, so they always agree. The words are in pingWords.ts.
import { Effect } from "effect";
import type { Action, VenueName } from "./domain.js";
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

    /** Whether the member has the Venue's role, read from Discord each time (never cached). */
    const status = Effect.fn("Pings.status")(function* (venue: VenueName, discordId: string) {
      return yield* role.has(venue, discordId);
    });

    /**
     * Whether to offer the Venue's role: only to a member who has never answered its offer and
     * doesn't have it. Dismissing the offer isn't an answer.
     */
    const offerFor = Effect.fn("Pings.offerFor")(function* (venue: VenueName, discordId: string) {
      if (yield* store.hasAnsweredPingOffer(venue, discordId)) return false;
      return !(yield* status(venue, discordId));
    });

    return {
      /** The Venue's role as members see it, "@Multiplayer ping": what the words call it where a mention can't go. */
      role: Effect.fn("Pings.role")(function* (venue: VenueName) {
        return `@${yield* role.nameIn(venue)}`;
      }),
      status,
      /** Add or remove the Venue's role. Choosing either way answers its offer too. */
      set: Effect.fn("Pings.set")(function* (venue: VenueName, discordId: string, on: boolean) {
        yield* on ? role.add(venue, discordId) : role.remove(venue, discordId);
        yield* store.answerPingOffer(venue, discordId);
      }),
      /**
       * Whether to offer the Venue's role after `action` went through: only after a Join or
       * Accept, to a member who is due it (`offerFor`). The action stands either way, so if
       * Discord can't say whether they have the role, the offer waits for a later Join.
       */
      offerAfter: Effect.fn("Pings.offerAfter")(function* (
        venue: VenueName,
        action: Action,
        discordId: string,
      ) {
        if (!OFFERED_AFTER.has(action)) return false;
        return yield* offerFor(venue, discordId).pipe(
          Effect.catchTag("PingRoleUnavailable", (e) => warnPingRole(e).pipe(Effect.as(false))),
        );
      }),
      /** The member said No to the Venue's offer: never make it again there. */
      decline: Effect.fn("Pings.decline")(function* (venue: VenueName, discordId: string) {
        yield* store.answerPingOffer(venue, discordId);
      }),
    } as const;
  }),
}) {}
