// The logged-in Discord client and the Venues the bot plays in: each a server, its Match channel
// and its @Multiplayer ping role (CONTEXT.md, src/venues.ts).
//
// The bot never creates or edits channels (spec #21, story 16): it is given each channel's id,
// and at startup it checks it can do everything it needs there. The home Venue failing that
// stops the bot; any other is left out, and ops told, while the bot runs on (spec #315).
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
import { HOME_VENUE, type VenueName } from "../domain.js";
import { OpsAlerts } from "../ops.js";
import { parseVenues, startVenues, VenueCheckFailed, type VenueConfig } from "../venues.js";

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

/** A synchronous discord.js read that can throw (a cache it expects isn't there). */
const readDiscord = <A>(op: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new DiscordError({ op, cause }) });

/** A running Venue on discord.js: checked at startup, so the bot can do everything it needs there. */
export interface DiscordVenue {
  readonly name: VenueName;
  /** Its Match channel. */
  readonly channel: TextChannel;
  /** Its @Multiplayer ping role's id: the bot can give, take and mention it. */
  readonly pingRoleId: string;
  /** That role's name on the server, as it was at startup: the words name the role by it. */
  readonly pingRoleName: string;
  /** The member's name in this Venue's server, for thread titles and images. */
  readonly displayName: (discordId: string) => Effect.Effect<string>;
  /** The member's name in this Venue's server, or None if they aren't in it; any other failure is Discord's. */
  readonly member: (discordId: string) => Effect.Effect<Option.Option<string>, DiscordError>;
}

/** NFKC turns "fancy text" (𝐁𝐨𝐥𝐝, Ｗｉｄｅ, ⓒⓘⓡⓒⓛⓔⓓ letters) into the plain letters the image fonts have. */
const plainName = (name: string) => name.normalize("NFKC");

/**
 * Check one Venue as the bot needs it, or say in one line what is wrong: its channel is a text
 * channel in its server with every permission the bot uses, and its ping role can be given,
 * taken and mentioned (Lobby pings would otherwise go silently missing). Roles are read over
 * REST: the Gateway intents stay at Guilds. A discord.js call that throws fails the check too.
 */
export const checkVenue = Effect.fn("checkVenue")(
  function* (client: Client<true>, venue: VenueConfig) {
    const where =
      venue.name === HOME_VENUE ? "DISCORD_CHANNEL_ID" : `Venue "${venue.name}"'s channel`;
    const fetched = yield* tryDiscord("fetch channel", () =>
      client.channels.fetch(venue.channelId),
    );
    if (fetched?.type !== ChannelType.GuildText)
      return yield* new VenueCheckFailed({
        reason: `${where} ${venue.channelId} is not a server text channel the bot can see`,
      });
    const channel: TextChannel = fetched;
    if (channel.guildId !== venue.guildId)
      return yield* new VenueCheckFailed({
        reason: `channel ${venue.channelId} is in server ${channel.guildId}, not ${venue.name === HOME_VENUE ? "DISCORD_GUILD_ID " : ""}${venue.guildId}`,
      });
    const guild = yield* readDiscord("read the channel's server", () => channel.guild);
    const perms = yield* readDiscord("read the bot's permissions", () =>
      channel.permissionsFor(client.user),
    );
    const missing = yield* readDiscord("read the bot's permissions", () =>
      REQUIRED_PERMISSIONS.filter(([, flag]) => !perms?.has(flag)).map(([name]) => name),
    );
    if (missing.length > 0)
      return yield* new VenueCheckFailed({
        reason: `the bot is missing permissions in #${channel.name}: ${missing.join(", ")}`,
      });

    const pingRole = yield* tryDiscord("fetch ping role", () =>
      guild.roles.fetch(venue.pingRoleId),
    );
    if (pingRole === null)
      return yield* new VenueCheckFailed({
        reason: `${venue.name === HOME_VENUE ? "DISCORD_PING_ROLE_ID" : "ping role"} ${venue.pingRoleId} is not a role in ${guild.name}`,
      });
    const self = yield* tryDiscord("fetch the bot's member", () => guild.members.fetchMe());
    const roleProblems = yield* readDiscord("read the bot's roles", () => [
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
    ]);
    if (roleProblems.length > 0)
      return yield* new VenueCheckFailed({
        reason: `the bot can't use the ping role @${pingRole.name}: it needs ${roleProblems.join("; ")}`,
      });
    yield* Effect.log(
      `Venue ${venue.name}: posting in #${channel.name} (${guild.name}); pinging @${pingRole.name}`,
    );

    const fetchMember = (discordId: string) =>
      tryDiscord("fetch member", () => guild.members.fetch(discordId));
    const running: DiscordVenue = {
      name: venue.name,
      channel,
      pingRoleId: venue.pingRoleId,
      pingRoleName: pingRole.name,
      displayName: (discordId) =>
        fetchMember(discordId).pipe(
          Effect.map((member) => plainName(member.displayName)),
          Effect.orElseSucceed(() => "Someone"),
        ),
      member: (discordId) =>
        fetchMember(discordId).pipe(
          Effect.map((member) => Option.some(plainName(member.displayName))),
          Effect.catchIf(
            (e) => isNotMember(e),
            () => Effect.succeed(Option.none<string>()),
          ),
        ),
    };
    return running;
  },
  Effect.catchTag("DiscordError", (e) =>
    Effect.fail(new VenueCheckFailed({ reason: describeDiscordError(e) })),
  ),
);

/** Whether a click came from this Venue's channel or one of its Match Threads. */
const isIn = (venue: DiscordVenue, i: Interaction) =>
  i.channelId === venue.channel.id ||
  (i.channel?.isThread() === true && i.channel.parentId === venue.channel.id);

export class Discord extends Effect.Service<Discord>()("multiballs/Discord", {
  scoped: Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN");
    const home = {
      guildId: yield* Config.string("DISCORD_GUILD_ID"),
      channelId: yield* Config.string("DISCORD_CHANNEL_ID"),
      /** The home Venue's @Multiplayer ping role. */
      pingRoleId: yield* Config.string("DISCORD_PING_ROLE_ID"),
    };
    const extra = yield* Config.option(Config.string("DISCORD_VENUES"));
    // The sandbox shares the dev app with `pnpm dev`, so clicks in the other copy's channel reach
    // it too: it leaves them to that copy rather than answering first.
    const sandbox = yield* Config.boolean("MULTIBALLS_SANDBOX").pipe(Config.withDefault(false));
    const alerts = yield* OpsAlerts;

    const client = yield* Effect.acquireRelease(
      // GuildMessages for postsIn: only that a message arrived, never its words (no Message Content).
      Effect.sync(
        () => new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] }),
      ),
      (c) => Effect.promise(() => c.destroy()),
    );
    const ready = yield* Effect.async<Client<true>, DiscordError>((resume) => {
      const onReady = (c: Client<true>) => resume(Effect.succeed(c));
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
    const me = ready.user;
    yield* Effect.log(`logged in as ${me.tag}`);

    const configured = parseVenues(home, Option.getOrUndefined(extra));
    for (const problem of configured.problems)
      yield* alerts.post(`Multiballs left out a Venue: ${problem}`);
    const venues = yield* startVenues(
      configured.venues,
      (venue) => checkVenue(ready, venue),
      (message) => alerts.post(message),
    );
    const [homeVenue] = venues;
    const homeGuildId = home.guildId;

    /** The running Venue a click came from, if any: its channel or one of its Match Threads. */
    const venueOf = (i: Interaction): DiscordVenue | undefined =>
      venues.find((venue) => isIn(venue, i));
    /** The running Venue by this name, if it runs. */
    const venueNamed = (name: VenueName): DiscordVenue | undefined =>
      venues.find((venue) => venue.name === name);

    const interactions = Stream.asyncPush<Interaction>((emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onInteraction = (i: Interaction) => {
            if (venueOf(i) !== undefined) emit.single(i);
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
     * A stream of the id of each message posted in another channel of the home Venue's server,
     * from anyone. It fails at once if that channel isn't one the bot can view, so a listener can
     * say so and stay off.
     */
    const postsIn = Effect.fn("postsIn")(function* (otherId: string) {
      const other = yield* tryDiscord("fetch channel", () => client.channels.fetch(otherId));
      const viewable =
        other !== null &&
        !other.isDMBased() &&
        other.guildId === homeGuildId &&
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
     * Which of these permissions the bot lacks in another text channel of the home Venue's
     * server; it fails when that isn't a channel of that server the bot can see.
     */
    const missingIn = Effect.fn("missingIn")(function* (
      otherId: string,
      required: ReadonlyArray<readonly [string, bigint]>,
    ) {
      const other = yield* tryDiscord("fetch channel", () => client.channels.fetch(otherId));
      if (other === null || other.isDMBased() || other.guildId !== homeGuildId)
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
      /** The game Discord's Venue: always running, or the bot wouldn't have started. */
      home: homeVenue,
      /** Every running Venue, home first. */
      venues,
      venueOf,
      venueNamed,
      /** Clicks from every running Venue's channel and its Match Threads. */
      interactions,
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
    } as const;
  }),
}) {}
