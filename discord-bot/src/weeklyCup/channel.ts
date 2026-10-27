// #weekly-cup (spec #353): the channel the Weekly Cup runs in, which the bot keeps in each
// server where the Cup is switched on, over the same SetupGuild port it sets a Venue up with
// (src/venues.ts). Read-only to members as the Match channel is: they press its buttons.
import { Effect, Option } from "effect";
import { MATCH_CHANNEL_ACCESS, type SetupGuild, VenueSetupFailed } from "../venues.js";

export const CUP_CHANNEL = "weekly-cup";

/**
 * The server's #weekly-cup: the stored one while it is still there (renamed or moved, it is
 * left alone), else a text channel named `weekly-cup` with the Match channel's overwrites set,
 * else a new one with them. Asks only for what it does: Manage Channels to make one, Manage Roles
 * to set a reused one's overwrites. Its id.
 */
export const keepCupChannel = Effect.fn("keepCupChannel")(function* (
  guild: SetupGuild,
  stored: Option.Option<string>,
) {
  const channels = yield* guild.textChannels;
  const kept = Option.filter(stored, (id) => channels.some((c) => c.id === id));
  if (Option.isSome(kept)) return kept.value;
  const found = channels.find((c) => c.name === CUP_CHANNEL);
  const bot = yield* guild.bot;
  const needs = found === undefined ? "Manage Channels" : "Manage Roles";
  if (bot.missing.includes(needs))
    return yield* new VenueSetupFailed({
      kind: `missing ${needs}`,
      reason:
        found === undefined
          ? `the bot needs ${needs} there to make #${CUP_CHANNEL}`
          : `the bot needs ${needs} there to set #${CUP_CHANNEL}'s permissions`,
    });
  if (found !== undefined) {
    yield* guild.setAccess(found.id, MATCH_CHANNEL_ACCESS);
    return found.id;
  }
  return yield* guild.createTextChannel(CUP_CHANNEL, MATCH_CHANNEL_ACCESS);
});
