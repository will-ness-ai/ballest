// A rejection in words, for the member who was turned down. Shared by the Discord buttons and
// the Activity, which name another member differently (a Discord mention, or a plain name).
import { Match } from "effect"
import type { Rejection } from "./engine.js"

export const explain = (e: Rejection, self: string, mention: (discordId: string) => string = (id) => `<@${id}>`): string =>
  Match.valueTags(e, {
    NotLinked: ({ discordId }) => (discordId === self ? "Link your Steam account first." : `${mention(discordId)} hasn't linked Steam yet.`),
    Busy: ({ discordId }) =>
      discordId === self
        ? "You're already in an open Invite or a live Match."
        : `${mention(discordId)} is already in an open Invite or a live Match.`,
    MatchNotFound: () => "That Invite is gone.",
    NotOpen: () => "That Invite isn't open anymore.",
    NotAllowed: ({ reason }) => reason,
    NotEnoughPlayers: ({ min }) => `A Lobby needs at least ${min} Players to start.`,
    NoEligibleMap: () =>
      "No Map suits this length. The Invite is closed; a longer Match allows more Maps.",
    SteamUnavailable: () => "Steam didn't answer. Try again in a moment.",
    ProfileNotFound: ({ reason }) => reason
  })
