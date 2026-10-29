// The PingRole port on discord.js: each running Venue's @Multiplayer ping role on its server, over
// REST (the Gateway intents stay at Guilds). Every read fetches the member afresh, so a
// moderator's change shows at once. The Discord service checked as each Venue started that the bot can
// manage each one.
import type { Guild } from "discord.js";
import { Effect, Layer, Option } from "effect";
import type { VenueName } from "../domain.js";
import { PingRole, PingRoleUnavailable } from "../ports.js";
import { Discord, type DiscordError, describeDiscordError, tryDiscord } from "./client.js";

export const PingRoleLive = Layer.effect(
  PingRole,
  Effect.gen(function* () {
    const discord = yield* Discord;
    /**
     * Run `use` on a running Venue's server and role, a Discord failure as the role unavailable; a
     * Venue that isn't running has no role to read or change.
     */
    const withRole = Effect.fn("withRole")(function* <A>(
      venue: VenueName,
      use: (guild: Guild, role: string) => Effect.Effect<A, DiscordError>,
    ) {
      const found = yield* discord.venueNamed(venue);
      if (Option.isNone(found))
        return yield* new PingRoleUnavailable({ reason: `Venue ${venue} isn't running` });
      return yield* use(found.value.channel.guild, found.value.pingRoleId).pipe(
        Effect.mapError((e) => new PingRoleUnavailable({ reason: describeDiscordError(e) })),
      );
    });
    return PingRole.of({
      has: (venue, discordId) =>
        withRole(venue, (guild, role) =>
          tryDiscord("fetch member's roles", () =>
            guild.members.fetch({ user: discordId, force: true }),
          ).pipe(Effect.map((member) => member.roles.cache.has(role))),
        ),
      add: (venue, discordId) =>
        withRole(venue, (guild, role) =>
          tryDiscord("add ping role", () =>
            guild.members.addRole({ user: discordId, role, reason: "Lobby pings: on" }),
          ).pipe(Effect.asVoid),
        ),
      remove: (venue, discordId) =>
        withRole(venue, (guild, role) =>
          tryDiscord("remove ping role", () =>
            guild.members.removeRole({ user: discordId, role, reason: "Lobby pings: off" }),
          ).pipe(Effect.asVoid),
        ),
    });
  }),
);
