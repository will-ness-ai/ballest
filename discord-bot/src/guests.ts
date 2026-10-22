// Where each guest Venue stands in this process (spec #321): the Venues the bot set up itself in
// servers that invited it, never home. The guests that start are fixed at startup; each is
// `starting` until its channel's Footer is up, then `up`, and `broken` once its channel or role
// is deleted, until the restart. Clicks, the Activity and the setup retry all read it here.
import { Context, Effect, Layer } from "effect";
import type { VenueName } from "./domain.js";

export type GuestState = "starting" | "up" | "broken";

export interface GuestStates {
  /** A guest Venue starts with this process: fixed from startup on. */
  readonly start: (venue: VenueName) => Effect.Effect<void>;
  /** Its channel's Footer is up: it is offered from now on, unless it broke meanwhile. */
  readonly up: (venue: VenueName) => Effect.Effect<void>;
  /** Its channel or role was deleted: offered no more, and repaired, until the restart. */
  readonly broke: (venue: VenueName) => Effect.Effect<void>;
  /** Where a Venue stands; undefined for one that didn't start as a guest (home among them). */
  readonly state: (venue: VenueName) => GuestState | undefined;
  /** Whether a Venue started as a guest, broken or not. */
  readonly started: (venue: VenueName) => boolean;
  /** A guest not on offer: still starting, or broken. */
  readonly unavailable: (venue: VenueName) => boolean;
}

/** The guest states, kept in memory: they last as long as the process. */
export const makeGuests = (): GuestStates => {
  const states = new Map<VenueName, GuestState>();
  const move = (venue: VenueName, from: ReadonlyArray<GuestState>, to: GuestState) =>
    Effect.sync(() => {
      const now = states.get(venue);
      if (now !== undefined && from.includes(now)) states.set(venue, to);
    });
  return {
    start: (venue) => Effect.sync(() => states.set(venue, "starting")),
    up: (venue) => move(venue, ["starting"], "up"),
    broke: (venue) => move(venue, ["starting", "up"], "broken"),
    state: (venue) => states.get(venue),
    started: (venue) => states.has(venue),
    unavailable: (venue) => {
      const now = states.get(venue);
      return now === "starting" || now === "broken";
    },
  };
};

export class Guests extends Context.Tag("multiballs/Guests")<Guests, GuestStates>() {}

export const GuestsLive = Layer.sync(Guests, makeGuests);
