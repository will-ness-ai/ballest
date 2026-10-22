// The SetupGuild port (src/venues.ts) on discord.js: a server's channels and roles over REST, and
// the channel and role the bot makes there. Every Discord failure is the setup's, in one line.
import {
  ChannelType,
  type Client,
  type Guild,
  OverwriteType,
  PermissionFlagsBits,
  type PermissionOverwriteOptions,
} from "discord.js";
import { Effect } from "effect";
import { type ChannelAccess, type SetupGuild, VenueSetupFailed } from "../venues.js";
import { type DiscordError, describeDiscordError, tryDiscord } from "./client.js";

const REASON = "Multiballs: its Match channel and ping role";

/** What setting a server up needs on the whole server: making the channel, the role and overwrites. */
const SERVER_PERMISSIONS: ReadonlyArray<readonly [string, bigint]> = [
  ["Manage Channels", PermissionFlagsBits.ManageChannels],
  ["Manage Roles", PermissionFlagsBits.ManageRoles],
];

const failed = <A>(effect: Effect.Effect<A, DiscordError>) =>
  effect.pipe(Effect.mapError((e) => new VenueSetupFailed({ reason: describeDiscordError(e) })));

/** Each flag set to `value`, as discord.js edits overwrites. */
const flags = (names: ReadonlyArray<string>, value: boolean): PermissionOverwriteOptions =>
  Object.fromEntries(names.map((name) => [name, value]));

export const setupGuildOn = (client: Client<true>, guild: Guild): SetupGuild => {
  const me = failed(tryDiscord("fetch the bot's member", () => guild.members.fetchMe()));
  return {
    id: guild.id,
    name: guild.name,
    missingServerPermissions: Effect.map(me, (self) =>
      SERVER_PERMISSIONS.filter(([, flag]) => !self.permissions.has(flag)).map(([name]) => name),
    ),
    textChannels: failed(tryDiscord("fetch channels", () => guild.channels.fetch())).pipe(
      Effect.map((all) =>
        [...all.values()].flatMap((c) =>
          c?.type === ChannelType.GuildText ? [{ id: c.id, name: c.name }] : [],
        ),
      ),
    ),
    createTextChannel: (name: string, access: ChannelAccess) =>
      failed(
        tryDiscord("create channel", () =>
          guild.channels.create({
            name,
            type: ChannelType.GuildText,
            reason: REASON,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                type: OverwriteType.Role,
                deny: [...access.everyoneDenied],
              },
              { id: client.user.id, type: OverwriteType.Member, allow: [...access.botAllowed] },
            ],
          }),
        ),
      ).pipe(Effect.map((channel) => channel.id)),
    setAccess: Effect.fn("setAccess")(function* (channelId: string, access: ChannelAccess) {
      const channel = yield* failed(
        tryDiscord("fetch channel", () => guild.channels.fetch(channelId)),
      );
      if (channel?.type !== ChannelType.GuildText)
        return yield* new VenueSetupFailed({ reason: `${channelId} is not a text channel` });
      yield* failed(
        tryDiscord("set channel permissions", async () => {
          await channel.permissionOverwrites.edit(
            guild.roles.everyone,
            flags(access.everyoneDenied, false),
            { reason: REASON, type: OverwriteType.Role },
          );
          await channel.permissionOverwrites.edit(client.user.id, flags(access.botAllowed, true), {
            reason: REASON,
            type: OverwriteType.Member,
          });
        }),
      );
    }),
    roles: failed(tryDiscord("fetch roles", () => guild.roles.fetch())).pipe(
      Effect.map((all) =>
        [...all.values()].map((r) => ({ id: r.id, name: r.name, position: r.position })),
      ),
    ),
    botTopRolePosition: Effect.map(me, (self) => self.roles.highest.position),
    // Discord puts a new role just above @everyone, so below the bot's own.
    createRole: (name: string) =>
      failed(
        tryDiscord("create role", () =>
          guild.roles.create({ name, mentionable: true, reason: REASON }),
        ),
      ).pipe(Effect.map((role) => role.id)),
  };
};
