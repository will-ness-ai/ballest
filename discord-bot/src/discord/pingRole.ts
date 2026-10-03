// The PingRole port on discord.js: the @Multiplayer ping role on the bot's server, over REST
// (the Gateway intents stay at Guilds). Every read fetches the member afresh, so a moderator's
// change shows at once. The Discord service checked at startup that the bot can manage it.
import { Effect, Layer } from "effect"
import { PingRole, PingRoleUnavailable } from "../ports.js"
import { Discord, type DiscordError, describeDiscordError, tryDiscord } from "./client.js"

export const PingRoleLive = Layer.effect(
  PingRole,
  Effect.gen(function* () {
    const discord = yield* Discord
    const { guild } = discord.channel
    const role = discord.pingRoleId
    const unavailable = Effect.mapError((e: DiscordError) => new PingRoleUnavailable({ reason: describeDiscordError(e) }))
    return PingRole.of({
      has: (discordId) =>
        tryDiscord("fetch member's roles", () => guild.members.fetch({ user: discordId, force: true })).pipe(
          Effect.map((member) => member.roles.cache.has(role)),
          unavailable
        ),
      add: (discordId) =>
        tryDiscord("add ping role", () => guild.members.addRole({ user: discordId, role, reason: "Lobby pings: on" })).pipe(
          Effect.asVoid,
          unavailable
        ),
      remove: (discordId) =>
        tryDiscord("remove ping role", () => guild.members.removeRole({ user: discordId, role, reason: "Lobby pings: off" })).pipe(
          Effect.asVoid,
          unavailable
        )
    })
  })
)
