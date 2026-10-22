// The PingRole port on discord.js: each running Venue's @Multiplayer ping role on its server, over
// REST (the Gateway intents stay at Guilds). Every read fetches the member afresh, so a
// moderator's change shows at once. The Discord service checked at startup that the bot can
// manage each one.
import type { Guild } from "discord.js";
import { Effect, Layer } from "effect";
import type { VenueName } from "../domain.js";
import { PingRole, PingRoleUnavailable } from "../ports.js";
import { Discord, type DiscordError, describeDiscordError, tryDiscord } from "./client.js";

/** What the role is called everywhere it was set up as spec #87 says. */
const USUAL_NAME = "Multiplayer ping";

export const PingRoleLive = Layer.effect(
  PingRole,
  Effect.gen(function* () {
    const discord = yield* Discord;
    const unavailable = Effect.mapError(
      (e: DiscordError) => new PingRoleUnavailable({ reason: describeDiscordError(e) }),
    );
    /** A running Venue's server and role; a Venue that isn't running has none to change. */
    const inVenue = Effect.fn("inVenue")(function* (venue: VenueName) {
      const found = discord.venueNamed(venue);
      if (found === undefined)
        return yield* new PingRoleUnavailable({ reason: `Venue ${venue} isn't running` });
      const running: { readonly guild: Guild; readonly role: string } = {
        guild: found.channel.guild,
        role: found.pingRoleId,
      };
      return running;
    });
    return PingRole.of({
      // Every caller names the Venue a member is in, which runs. Were one not to, the words fall
      // back to the usual name, said in the log, rather than failing a reply over a label.
      nameIn: Effect.fn("PingRole.nameIn")(function* (venue: VenueName) {
        const found = discord.venueNamed(venue);
        if (found !== undefined) return found.pingRoleName;
        yield* Effect.logWarning(
          `ping role: Venue ${venue} isn't running; naming it ${USUAL_NAME}`,
        );
        return USUAL_NAME;
      }),
      has: (venue, discordId) =>
        inVenue(venue).pipe(
          Effect.flatMap(({ guild, role }) =>
            tryDiscord("fetch member's roles", () =>
              guild.members.fetch({ user: discordId, force: true }),
            ).pipe(
              Effect.map((member) => member.roles.cache.has(role)),
              unavailable,
            ),
          ),
        ),
      add: (venue, discordId) =>
        inVenue(venue).pipe(
          Effect.flatMap(({ guild, role }) =>
            tryDiscord("add ping role", () =>
              guild.members.addRole({ user: discordId, role, reason: "Lobby pings: on" }),
            ).pipe(Effect.asVoid, unavailable),
          ),
        ),
      remove: (venue, discordId) =>
        inVenue(venue).pipe(
          Effect.flatMap(({ guild, role }) =>
            tryDiscord("remove ping role", () =>
              guild.members.removeRole({ user: discordId, role, reason: "Lobby pings: off" }),
            ).pipe(Effect.asVoid, unavailable),
          ),
        ),
    });
  }),
);
