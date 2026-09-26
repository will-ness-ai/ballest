// The logged-in Discord client and the one channel the bot lives in.
//
// The bot never creates or edits channels (spec #21, story 16): it is given the channel's id,
// and at startup it checks it can do everything it needs there, or refuses to start.
import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits, type Interaction, type TextChannel } from "discord.js"
import { Config, Data, Effect, Redacted, Stream } from "effect"

export class DiscordError extends Data.TaggedError("DiscordError")<{ readonly op: string; readonly cause: unknown }> {}

const REQUIRED_PERMISSIONS: ReadonlyArray<[string, bigint]> = [
  ["View Channel", PermissionFlagsBits.ViewChannel],
  ["Send Messages", PermissionFlagsBits.SendMessages],
  ["Embed Links", PermissionFlagsBits.EmbedLinks],
  ["Attach Files", PermissionFlagsBits.AttachFiles],
  ["Read Message History", PermissionFlagsBits.ReadMessageHistory],
  ["Create Public Threads", PermissionFlagsBits.CreatePublicThreads],
  ["Send Messages in Threads", PermissionFlagsBits.SendMessagesInThreads],
  ["Manage Threads", PermissionFlagsBits.ManageThreads]
]

export const tryDiscord = <A>(op: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new DiscordError({ op, cause }) })

export class Discord extends Effect.Service<Discord>()("multiballs/Discord", {
  scoped: Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN")
    const guildId = yield* Config.string("DISCORD_GUILD_ID")
    const channelId = yield* Config.string("DISCORD_CHANNEL_ID")

    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new Client({ intents: [GatewayIntentBits.Guilds] })),
      (c) => Effect.promise(() => c.destroy())
    )
    yield* Effect.async<void, DiscordError>((resume) => {
      const onReady = () => resume(Effect.void)
      client.once(Events.ClientReady, onReady)
      client.login(Redacted.value(token)).catch((cause) => resume(Effect.fail(new DiscordError({ op: "login", cause }))))
      return Effect.sync(() => client.off(Events.ClientReady, onReady))
    }).pipe(Effect.timeoutFail({ duration: "30 seconds", onTimeout: () => new DiscordError({ op: "login", cause: "timed out" }) }))

    const fetched = yield* tryDiscord("fetch channel", () => client.channels.fetch(channelId))
    if (fetched === null || fetched.type !== ChannelType.GuildText)
      return yield* Effect.dieMessage(`DISCORD_CHANNEL_ID ${channelId} is not a server text channel the bot can see`)
    const channel: TextChannel = fetched
    if (channel.guildId !== guildId)
      return yield* Effect.dieMessage(`channel ${channelId} is in server ${channel.guildId}, not DISCORD_GUILD_ID ${guildId}`)
    const me = client.user
    const perms = me === null ? null : channel.permissionsFor(me)
    const missing = REQUIRED_PERMISSIONS.filter(([, flag]) => !perms?.has(flag)).map(([name]) => name)
    if (missing.length > 0)
      return yield* Effect.dieMessage(`the bot is missing permissions in #${channel.name}: ${missing.join(", ")}`)
    yield* Effect.log(`logged in as ${me?.tag}; posting in #${channel.name} (${channel.guild.name})`)

    const interactions = Stream.asyncPush<Interaction>((emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onInteraction = (i: Interaction) => {
            if (i.channelId === channelId || (i.channel?.isThread() && i.channel.parentId === channelId)) emit.single(i)
            else if (i.isRepliable()) void i.reply({ content: "Multiballs only works in its own channel.", ephemeral: true }).catch(() => {})
          }
          client.on(Events.InteractionCreate, onInteraction)
          return onInteraction
        }),
        (onInteraction) => Effect.sync(() => client.off(Events.InteractionCreate, onInteraction))
      )
    )

    return {
      channel,
      interactions,
      /** The member's name in this server, for thread titles. */
      displayName: Effect.fn("displayName")(function* (discordId: string) {
        return yield* tryDiscord("fetch member", () => channel.guild.members.fetch(discordId)).pipe(
          Effect.map((member) => member.displayName),
          Effect.orElseSucceed(() => "Someone")
        )
      })
    } as const
  })
}) {}
