// The logged-in Discord client and the one channel the bot lives in.
//
// The bot never creates or edits its Match channel (spec #21, story 16): it is given the
// channel's id, and at startup it checks it can do everything it needs there, or refuses to
// start. The one channel it makes itself is #my-stats (spec #323, myStats.ts), whose panel's
// presses reach the bot once `answerIn` names it.
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Interaction,
  type Message,
  type TextChannel,
} from "discord.js";
import { Config, Data, Effect, Option, Redacted, Stream } from "effect";

export class DiscordError extends Data.TaggedError("DiscordError")<{
  readonly op: string;
  readonly cause: unknown;
}> {}

const REQUIRED_PERMISSIONS: ReadonlyArray<[string, bigint]> = [
  ["View Channel", PermissionFlagsBits.ViewChannel],
  ["Send Messages", PermissionFlagsBits.SendMessages],
  ["Embed Links", PermissionFlagsBits.EmbedLinks],
  ["Attach Files", PermissionFlagsBits.AttachFiles],
  ["Read Message History", PermissionFlagsBits.ReadMessageHistory],
  ["Create Public Threads", PermissionFlagsBits.CreatePublicThreads],
  ["Send Messages in Threads", PermissionFlagsBits.SendMessagesInThreads],
  ["Manage Threads", PermissionFlagsBits.ManageThreads],
];

/** A cause in one line: Discord's error code, if any, and its message. Stack traces stay out of the log. */
export const oneLine = (cause: unknown): string => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? `[${String(cause.code)}] `
      : "";
  return `${code}${cause instanceof Error ? cause.message : String(cause)}`;
};

/** A Discord failure in one line: what the bot was doing, and what Discord said. */
export const describeDiscordError = (e: DiscordError) => `${e.op}: ${oneLine(e.cause)}`;

/** Discord's "Unknown Member" and "Unknown User" errors: nobody by that id is in the server. */
const isNotMember = (e: DiscordError) =>
  typeof e.cause === "object" &&
  e.cause !== null &&
  "code" in e.cause &&
  (e.cause.code === 10007 || e.cause.code === 10013);

/** Discord's "Unknown Message" and "Unknown Channel" errors: the thing was already deleted. */
export const isUnknown = (e: DiscordError) =>
  typeof e.cause === "object" &&
  e.cause !== null &&
  "code" in e.cause &&
  (e.cause.code === 10008 || e.cause.code === 10003);

export const tryDiscord = <A>(op: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new DiscordError({ op, cause }) });

export class Discord extends Effect.Service<Discord>()("multiballs/Discord", {
  scoped: Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN");
    const guildId = yield* Config.string("DISCORD_GUILD_ID");
    const channelId = yield* Config.string("DISCORD_CHANNEL_ID");
    /** The @Multiplayer ping role: the one role the bot adds, removes and mentions. */
    const pingRoleId = yield* Config.string("DISCORD_PING_ROLE_ID");
    // The sandbox shares the dev app with `pnpm dev`, so clicks in the other copy's channel reach
    // it too: it leaves them to that copy rather than answering first.
    const sandbox = yield* Config.boolean("MULTIBALLS_SANDBOX").pipe(Config.withDefault(false));

    const client = yield* Effect.acquireRelease(
      // GuildMessages for postsIn: only that a message arrived, never its words (no Message Content).
      Effect.sync(
        () => new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] }),
      ),
      (c) => Effect.promise(() => c.destroy()),
    );
    yield* Effect.async<undefined, DiscordError>((resume) => {
      const onReady = () => resume(Effect.succeed(undefined));
      client.once(Events.ClientReady, onReady);
      client
        .login(Redacted.value(token))
        .catch((cause: unknown) => resume(Effect.fail(new DiscordError({ op: "login", cause }))));
      return Effect.sync(() => client.off(Events.ClientReady, onReady));
    }).pipe(
      Effect.timeoutFail({
        duration: "30 seconds",
        onTimeout: () => new DiscordError({ op: "login", cause: "timed out" }),
      }),
    );

    const fetched = yield* tryDiscord("fetch channel", () => client.channels.fetch(channelId));
    if (fetched?.type !== ChannelType.GuildText)
      return yield* Effect.dieMessage(
        `DISCORD_CHANNEL_ID ${channelId} is not a server text channel the bot can see`,
      );
    const channel: TextChannel = fetched;
    if (channel.guildId !== guildId)
      return yield* Effect.dieMessage(
        `channel ${channelId} is in server ${channel.guildId}, not DISCORD_GUILD_ID ${guildId}`,
      );
    const me = client.user;
    const perms = me === null ? null : channel.permissionsFor(me);
    const missing = REQUIRED_PERMISSIONS.filter(([, flag]) => !perms?.has(flag)).map(
      ([name]) => name,
    );
    if (missing.length > 0)
      return yield* Effect.dieMessage(
        `the bot is missing permissions in #${channel.name}: ${missing.join(", ")}`,
      );

    // Lobby pings: the bot must be able to give, take and mention the role, or a Lobby's ping
    // would go silently missing. Roles are read over REST: the Gateway intents stay at Guilds.
    const pingRole = yield* tryDiscord("fetch ping role", () =>
      channel.guild.roles.fetch(pingRoleId),
    );
    if (pingRole === null)
      return yield* Effect.dieMessage(
        `DISCORD_PING_ROLE_ID ${pingRoleId} is not a role in ${channel.guild.name}`,
      );
    const self = yield* tryDiscord("fetch the bot's member", () => channel.guild.members.fetchMe());
    const roleProblems = [
      ...(self.permissions.has(PermissionFlagsBits.ManageRoles)
        ? []
        : ["the Manage Roles permission"]),
      ...(self.roles.highest.comparePositionTo(pingRole) > 0
        ? []
        : [`a role above @${pingRole.name} (move the bot's role higher)`]),
      ...(pingRole.mentionable || perms?.has(PermissionFlagsBits.MentionEveryone)
        ? []
        : [
            `a way to mention @${pingRole.name} (make the role mentionable, or allow Mention @everyone, @here and All Roles in #${channel.name})`,
          ]),
    ];
    if (roleProblems.length > 0)
      return yield* Effect.dieMessage(
        `the bot can't use the ping role @${pingRole.name}: it needs ${roleProblems.join("; ")}`,
      );
    yield* Effect.log(
      `logged in as ${me?.tag}; posting in #${channel.name} (${channel.guild.name}); pinging @${pingRole.name}`,
    );

    /** Other channels whose presses are the bot's too: #my-stats, once it is found or made. */
    const alsoAnswered = new Set<string>();

    const interactions = Stream.asyncPush<Interaction>((emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onInteraction = (i: Interaction) => {
            if (
              i.channelId === channelId ||
              (i.channelId !== null && alsoAnswered.has(i.channelId)) ||
              (i.channel?.isThread() && i.channel.parentId === channelId)
            )
              emit.single(i);
            else if (!sandbox && i.isRepliable())
              void i
                .reply({ content: "Multiballs only works in its own channel.", ephemeral: true })
                .catch(() => undefined);
          };
          client.on(Events.InteractionCreate, onInteraction);
          return onInteraction;
        }),
        (onInteraction) => Effect.sync(() => client.off(Events.InteractionCreate, onInteraction)),
      ),
    );

    /**
     * A stream of the id of each message posted in another channel of this server, from
     * anyone. It fails at once if that channel isn't one the bot can view, so a listener can say
     * so and stay off.
     */
    const postsIn = Effect.fn("postsIn")(function* (otherId: string) {
      const other = yield* tryDiscord("fetch channel", () => client.channels.fetch(otherId));
      const viewable =
        other !== null &&
        !other.isDMBased() &&
        other.guildId === guildId &&
        me !== null &&
        (other.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) ?? false);
      if (!viewable)
        return yield* Effect.fail(
          new DiscordError({
            op: "fetch channel",
            cause: `${otherId} is not a channel the bot can view in this server`,
          }),
        );
      return Stream.asyncPush<string>((emit) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const onMessage = (m: Message) => {
              if (m.channelId === otherId) emit.single(m.id);
            };
            client.on(Events.MessageCreate, onMessage);
            return onMessage;
          }),
          (onMessage) => Effect.sync(() => client.off(Events.MessageCreate, onMessage)),
        ),
      );
    });

    /**
     * Which of these permissions the bot lacks in another text channel of this server; it fails
     * when that isn't a channel of this server the bot can see.
     */
    const missingIn = Effect.fn("missingIn")(function* (
      otherId: string,
      required: ReadonlyArray<readonly [string, bigint]>,
    ) {
      const other = yield* tryDiscord("fetch channel", () => client.channels.fetch(otherId));
      if (other === null || other.isDMBased() || other.guildId !== guildId || me === null)
        return yield* Effect.fail(
          new DiscordError({
            op: "fetch channel",
            cause: `${otherId} is not a channel the bot can see in this server`,
          }),
        );
      const perms = other.permissionsFor(me);
      return required.filter(([, flag]) => !(perms?.has(flag) ?? false)).map(([name]) => name);
    });

    const application = client.application;
    if (application === null) return yield* Effect.dieMessage("logged in without an application");

    return {
      channel,
      /** The @Multiplayer ping role's id, checked at startup: the bot can give, take and mention it. */
      pingRoleId,
      /** That role's name on the server, as it was at startup: the words name the role by it. */
      pingRoleName: pingRole.name,
      interactions,
      /** Take presses in another channel of this server too, as in the bot's own. */
      answerIn: (otherId: string) => Effect.sync(() => void alsoAnswered.add(otherId)),
      postsIn,
      missingIn,
      /** The application's own emojis (usable anywhere the bot posts), name to id. */
      appEmojis: tryDiscord("fetch app emojis", () => application.emojis.fetch()).pipe(
        Effect.map((all) => new Map(all.map((emoji) => [emoji.name, emoji.id]))),
      ),
      /** Upload an application emoji; its id. */
      createAppEmoji: (name: string, png: Buffer) =>
        tryDiscord("create app emoji", () =>
          application.emojis.create({ name, attachment: png }),
        ).pipe(Effect.map((emoji) => emoji.id)),
      /** The member's name in this server, for thread titles. */
      displayName: Effect.fn("displayName")(function* (discordId: string) {
        return yield* tryDiscord("fetch member", () => channel.guild.members.fetch(discordId)).pipe(
          // NFKC turns "fancy text" (𝐁𝐨𝐥𝐝, Ｗｉｄｅ, ⓒⓘⓡⓒⓛⓔⓓ letters) into the plain letters the image fonts have.
          Effect.map((member) => member.displayName.normalize("NFKC")),
          Effect.orElseSucceed(() => "Someone"),
        );
      }),
      /** The member's name in this server, or None if they aren't in it; any other failure is Discord's. */
      member: Effect.fn("member")(function* (discordId: string) {
        return yield* tryDiscord("fetch member", () => channel.guild.members.fetch(discordId)).pipe(
          Effect.map((member) => Option.some(member.displayName.normalize("NFKC"))),
          Effect.catchIf(
            (e) => isNotMember(e),
            () => Effect.succeed(Option.none<string>()),
          ),
        );
      }),
    } as const;
  }),
}) {}
