// The presses on a Weekly Cup's posts (spec #353): Sign up and Withdraw until Sunday 20:00, the
// Shortlist's vote until Friday 09:00, and Skip (Manage Server, while the week is open). Each acts
// on the week its button names, under the Cup's lock, and is answered privately in words.
import { Clock, Effect, Option } from "effect";
import { escape, mapName } from "../links.js";
import type { CupKit } from "./kit.js";
import { CUP_MAPS, type CupState, type SkipAsk, signUpOpen } from "./model.js";
import type { CupRace } from "./race.js";
import type { CupRecord } from "./record.js";
import { type CupWeek, weekAt } from "./week.js";

/** The presses on one server's Cup posts, each for the week its button names. */
export interface CupPresses {
  readonly signUp: (week: string, discordId: string) => Effect.Effect<string>;
  readonly withdraw: (week: string, discordId: string) => Effect.Effect<string>;
  /** An Entrant's picks, by pfid. */
  readonly vote: (
    week: string,
    discordId: string,
    picks: ReadonlyArray<string>,
  ) => Effect.Effect<string>;
  /** `manageServer`: whether the member holds Manage Server there. */
  readonly askSkip: (
    week: string,
    discordId: string,
    manageServer: boolean,
  ) => Effect.Effect<SkipAsk>;
  readonly skip: (week: string, discordId: string, manageServer: boolean) => Effect.Effect<string>;
}

const ADMINS_ONLY = "Only a server admin (Manage Server) can skip a week.";

/** Why a member can't sign up for, withdraw from or vote in a Cup in this state. */
const closedBecause = (state: CupState | null): string => {
  switch (state) {
    case "cancelled":
      return "This week's Weekly Cup was cancelled. The next one opens on Monday.";
    case "skipped":
      return "This week's Weekly Cup was skipped. The next one opens on Monday.";
    default:
      return "This week's Weekly Cup is over.";
  }
};

const unix = (ms: number) => Math.floor(ms / 1000);

export const makePresses = (kit: CupKit, race: CupRace): CupPresses => {
  const { guildId, log, locked } = kit;

  /** The week a press was for, if it is still this week, with its Cup. */
  const pressedFor = Effect.fn("cup.pressedFor")(function* (pressed: string) {
    const week = weekAt(yield* Clock.currentTimeMillis);
    if (week.week !== pressed) return Option.none<{ week: CupWeek; cup: CupRecord }>();
    return Option.map(yield* log.get(guildId, pressed), (cup) => ({ week, cup }));
  });

  const signUp = Effect.fn("cup.signUp")(function* (pressed: string, discordId: string) {
    return yield* locked(
      Effect.gen(function* () {
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found) || !signUpOpen(found.value.cup.state))
          return closedBecause(Option.getOrNull(Option.map(found, (f) => f.cup.state)));
        const { week, cup } = found.value;
        const signedUpAt = yield* Clock.currentTimeMillis;
        // Sunday 20:00 closes sign-up, even while the final read still waits for Steam.
        if (signedUpAt >= week.endsAt) return closedBecause("final");
        const already = "You're already signed up for this week's Cup.";
        if ((yield* kit.entrantIds(pressed)).includes(discordId)) return already;
        // Once the bars are taken as racing opens, a later Entrant's bar is their PB as they sign
        // up, read before they are an Entrant, so none signs up without one.
        if (cup.barsAt !== null) {
          const maps = (yield* race.cupMapsOf(pressed)).map((m) => m.map);
          const bars = yield* Effect.either(race.barsOf(maps, [discordId]));
          if (bars._tag === "Left")
            return "Steam isn't answering just now, and your times on the Cup Maps are needed to sign you up. Try again in a few minutes.";
          yield* log.putBaselines(guildId, pressed, [discordId], bars.right);
        }
        if (!(yield* log.addEntrant(guildId, pressed, { discordId, signedUpAt }))) return already;
        yield* kit.redraw(week, cup);
        return cup.state === "open"
          ? `You're signed up for this week's Weekly Cup. The Shortlist is drawn <t:${unix(week.shortlistAt)}:F>, and racing runs <t:${unix(week.voteClosesAt)}:F> to <t:${unix(week.endsAt)}:F>.`
          : `You're signed up for this week's Weekly Cup. It ends <t:${unix(week.endsAt)}:F>.`;
      }),
    );
  });

  const withdraw = Effect.fn("cup.withdraw")(function* (pressed: string, discordId: string) {
    return yield* locked(
      Effect.gen(function* () {
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found) || !signUpOpen(found.value.cup.state))
          return closedBecause(Option.getOrNull(Option.map(found, (f) => f.cup.state)));
        const { week, cup } = found.value;
        if ((yield* Clock.currentTimeMillis) >= week.endsAt) return closedBecause("final");
        if (!(yield* log.removeEntrant(guildId, pressed, discordId)))
          return "You're not signed up for this week's Cup.";
        yield* kit.redraw(week, cup);
        return "You've withdrawn from this week's Weekly Cup. Sign up again any time before it ends.";
      }),
    );
  });

  /** An Entrant's pick of up to 3 Shortlist Maps, replacing the one before, until Friday 09:00. */
  const vote = Effect.fn("cup.vote")(function* (
    pressed: string,
    discordId: string,
    picks: ReadonlyArray<string>,
  ) {
    return yield* locked(
      Effect.gen(function* () {
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found)) return closedBecause(null);
        const { week, cup } = found.value;
        const now = yield* Clock.currentTimeMillis;
        if (cup.state === "cancelled" || cup.state === "skipped") return closedBecause(cup.state);
        if (cup.state === "open")
          return now < week.shortlistAt
            ? `The Shortlist isn't drawn yet: it comes <t:${unix(week.shortlistAt)}:F>.`
            : "The Shortlist is still being drawn. Try again in a minute.";
        if (cup.state !== "voting" || now >= week.voteClosesAt) return "The vote has closed.";
        if (!(yield* kit.entrantIds(pressed)).includes(discordId))
          return "Only Entrants can vote. Sign up on the Cup's post first.";
        if (picks.length === 0) return "Pick at least one Map.";
        if (picks.length > CUP_MAPS) return `Pick up to ${CUP_MAPS} Maps.`;
        if (new Set(picks).size !== picks.length) return "Pick each Map once.";
        const shortlist = (yield* log.shortlist(guildId, pressed)).map((s) => s.map);
        const picked = picks.map((pfid) => shortlist.find((m) => m.pfid === pfid));
        const named = picked.flatMap((m) => (m === undefined ? [] : [m]));
        if (named.length !== picks.length) return "That Map isn't on this week's Shortlist.";
        yield* log.putVote(guildId, pressed, { discordId, picks });
        return `Your vote: ${named.map((m) => `**${escape(mapName(m))}**`).join(", ")}. You can change it until <t:${unix(week.voteClosesAt)}:F>.`;
      }),
    );
  });

  /** The week to skip, if this member can skip it now; else why not. */
  const skippable = Effect.fn("cup.skippable")(function* (pressed: string, manageServer: boolean) {
    if (!manageServer) return { _tag: "Refused", text: ADMINS_ONLY } as const;
    const found = yield* pressedFor(pressed);
    if (Option.isNone(found)) return { _tag: "Refused", text: closedBecause(null) } as const;
    const { week, cup } = found.value;
    if (cup.state === "open" && (yield* Clock.currentTimeMillis) < week.shortlistAt)
      return { _tag: "Skippable", week, cup } as const;
    const text = signUpOpen(cup.state)
      ? "This week's Weekly Cup is already under way, so it can't be skipped now."
      : closedBecause(cup.state);
    return { _tag: "Refused", text } as const;
  });

  const askSkip = Effect.fn("cup.askSkip")(function* (
    pressed: string,
    _discordId: string,
    manageServer: boolean,
  ) {
    const can = yield* locked(skippable(pressed, manageServer));
    return can._tag === "Refused" ? can : ({ _tag: "Confirm", week: pressed } satisfies SkipAsk);
  });

  const skip = Effect.fn("cup.skip")(function* (
    pressed: string,
    discordId: string,
    manageServer: boolean,
  ) {
    return yield* locked(
      Effect.gen(function* () {
        const can = yield* skippable(pressed, manageServer);
        if (can._tag === "Refused") return can.text;
        yield* kit.callOff(can.week, can.cup, { _tag: "Skipped" });
        yield* Effect.logInfo(`weekly cup: ${discordId} skipped ${pressed} in ${guildId}`);
        return "Skipped this week's Weekly Cup. Its Entrants have been told.";
      }),
    );
  });

  return { signUp, withdraw, vote, askSkip, skip };
};
