// The logged-in Discord client and the Venues the bot plays in: each a server, its Match channel
// and its @Multiplayer ping role (CONTEXT.md, src/venues.ts).
//
// The home Venue is given by its ids, and at startup the bot checks it can do everything it needs
// there; failing that stops the bot. Every server that invites the bot it sets up as a Venue itself
// (spec #321, the rules in src/venues.ts): it makes or reuses the channel and the ping role there,
// checks them the same way, and starts the Venue at once. One it can't set up yet, or that fails
// its check, is tried again every few minutes (ops told once per reason) while the bot runs on;
// one the bot is removed from stops running. The sandbox sets up nothing: `pnpm dev` does that.
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  PermissionFlagsBits,
  type Interaction,
  type Message,
  type TextChannel,
} from "discord.js";
import {
  Config,
  type Context,
  Data,
  Effect,
  Option,
  Redacted,
  Schedule,
  Stream,
  SubscriptionRef,
} from "effect";
import { HOME_VENUE, type VenueName } from "../domain.js";
import { OpsAlerts } from "../ops.js";
import {
  homeVenue,
  makeVenueJoiner,
  REQUIRED_PERMISSIONS as REQUIRED,
  startHome,
  VenueCheckFailed,
  type VenueConfig,
  VenueRecords,
} from "../venues.js";
import { setupGuildOn } from "./setupGuild.js";

export class DiscordError extends Data.TaggedError("DiscordError")<{
  readonly op: string;
  readonly cause: unknown;
}> {}

const REQUIRED_PERMISSIONS: ReadonlyArray<readonly [string, bigint]> = REQUIRED.map(
  ([label, flag]) => [label, PermissionFlagsBits[flag]] as const,
);

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

/** Discord's "Unknown Channel" error: the channel was deleted. */
export const isUnknownChannel = (e: DiscordError) =>
  typeof e.cause === "object" && e.cause !== null && "code" in e.cause && e.cause.code === 10003;

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

/** A running Venue on discord.js: checked as it started, so the bot can do everything it needs there. */
export interface DiscordVenue {
  readonly name: VenueName;
  /** Its Match channel. */
  readonly channel: TextChannel;
  /** Its @Multiplayer ping role's id: the bot can give, take and mention it. */
  readonly pingRoleId: string;
  /** That role's name on the server, as it was when the Venue started: the words name the role by it. */
  readonly pingRoleName: string;
  /** The member's name in this Venue's server, for thread titles and images. */
  readonly displayName: (discordId: string) => Effect.Effect<string>;
  /** The member's name in this Venue's server, or None if they aren't in it; any other failure is Discord's. */
  readonly member: (discordId: string) => Effect.Effect<Option.Option<string>, DiscordError>;
}

/** A click or form, with the running Venue it came from: its channel or one of its Match Threads. */
export interface VenueInteraction {
  readonly interaction: Interaction;
  readonly venue: DiscordVenue;
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
    const guild = channel.guild;
    const perms = yield* readDiscord("read the bot's permissions", () =>
      channel.permissionsFor(client.user),
    );
    const missing = REQUIRED_PERMISSIONS.filter(([, flag]) => !perms?.has(flag)).map(
      ([name]) => name,
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
    Effect.fail(new VenueCheckFailed({ reason: describeDiscordError(e), kind: "discord" })),
  ),
);

/** Whether a click came from this Venue's channel or one of its Match Threads. */
const isIn = (venue: DiscordVenue, i: Interaction) =>
  i.channelId === venue.channel.id ||
  (i.channel?.isThread() === true && i.channel.parentId === venue.channel.id);

/** How often a wanted server that isn't running is tried again. */
const RETRY_EVERY = "5 minutes";

/**
 * Make Venues of the servers the bot is invited to (`makeVenueJoiner`), and stop those it is
 * removed from: at startup (in the background, so home comes up at once), on each join, when a
 * server comes back from an outage, and every few minutes, which also picks up a server whose
 * permissions were fixed (re-authorizing an invite fires no join). Runs in the caller's scope;
 * returns how to stop a Venue whose channel is gone, so the next retry repairs it.
 */
const followServers = Effect.fn("followServers")(function* (
  client: Client<true>,
  homeGuildId: string,
  running: SubscriptionRef.SubscriptionRef<ReadonlyMap<VenueName, DiscordVenue>>,
  records: Context.Tag.Service<typeof VenueRecords>,
  alert: (message: string) => Effect.Effect<void>,
) {
  const joiner = yield* makeVenueJoiner(homeGuildId, (venue) => checkVenue(client, venue), alert, {
    has: (name) => Effect.map(SubscriptionRef.get(running), (all) => all.has(name)),
    start: (name, venue) => SubscriptionRef.update(running, (all) => new Map(all).set(name, venue)),
    stop: (name) =>
      SubscriptionRef.update(running, (all) => {
        if (!all.has(name)) return all;
        const next = new Map(all);
        next.delete(name);
        return next;
      }).pipe(Effect.zipRight(Effect.log(`Venue ${name} stopped`))),
  }).pipe(Effect.provideService(VenueRecords, records));
  // The joiner tries each server on its own and logs a bug in one; this keeps a bug outside that
  // (its database reads) from ending the event, startup and retry fibers.
  const guarded = (what: string, effect: Effect.Effect<void>) =>
    effect.pipe(Effect.catchAllDefect((defect) => Effect.logError(`${what} failed`, defect)));

  interface ServerEvent {
    readonly _tag: "Invited" | "Available" | "Removed";
    readonly guild: Guild;
  }
  // discord.js reports a server that is only unavailable (an outage) apart from one the bot was
  // removed from, so an outage stops no Venue.
  const events = Stream.asyncPush<ServerEvent>((emit) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const on = {
          [Events.GuildCreate]: (guild: Guild) => emit.single({ _tag: "Invited", guild }),
          [Events.GuildAvailable]: (guild: Guild) => emit.single({ _tag: "Available", guild }),
          [Events.GuildDelete]: (guild: Guild) => emit.single({ _tag: "Removed", guild }),
        } as const;
        client.on(Events.GuildCreate, on[Events.GuildCreate]);
        client.on(Events.GuildAvailable, on[Events.GuildAvailable]);
        client.on(Events.GuildDelete, on[Events.GuildDelete]);
        return on;
      }),
      (on) =>
        Effect.sync(() => {
          client.off(Events.GuildCreate, on[Events.GuildCreate]);
          client.off(Events.GuildAvailable, on[Events.GuildAvailable]);
          client.off(Events.GuildDelete, on[Events.GuildDelete]);
        }),
    ),
  );
  yield* events.pipe(
    Stream.runForEach(({ _tag, guild }) =>
      guarded(
        `${_tag} ${guild.id}`,
        _tag === "Invited"
          ? joiner.invited(setupGuildOn(client, guild))
          : _tag === "Available"
            ? joiner.retry(setupGuildOn(client, guild))
            : joiner.removed(guild.id),
      ),
    ),
    Effect.forkScoped,
  );
  const everyServer = () => [...client.guilds.cache.values()].map((g) => setupGuildOn(client, g));
  yield* guarded("setting up servers at startup", joiner.startup(everyServer())).pipe(
    Effect.forkScoped,
  );
  // The servers as they are at each retry.
  yield* Effect.suspend(() =>
    Effect.forEach(everyServer(), (guild) => guarded(`retrying ${guild.id}`, joiner.retry(guild))),
  ).pipe(Effect.delay(RETRY_EVERY), Effect.repeat(Schedule.spaced(RETRY_EVERY)), Effect.forkScoped);
  return (name: VenueName) => joiner.removed(name);
});

export class Discord extends Effect.Service<Discord>()("multiballs/Discord", {
  scoped: Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN");
    const home = homeVenue({
      guildId: yield* Config.string("DISCORD_GUILD_ID"),
      channelId: yield* Config.string("DISCORD_CHANNEL_ID"),
      /** The home Venue's @Multiplayer ping role. */
      pingRoleId: yield* Config.string("DISCORD_PING_ROLE_ID"),
    });
    // The sandbox shares the dev app with `pnpm dev`, so clicks in the other copy's channel reach
    // it too: it leaves them to that copy rather than answering first.
    const sandbox = yield* Config.boolean("MULTIBALLS_SANDBOX").pipe(Config.withDefault(false));
    const alerts = yield* OpsAlerts;
    const records = yield* VenueRecords;

    const client = yield* Effect.acquireRelease(
      // GuildMessages for postsIn: only that a message arrived, never its words (no Message Content).
      // Guilds brings the server joins and removals that start and stop the other Venues.
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

    const homeRunning = yield* startHome(home, (venue) => checkVenue(ready, venue));
    const homeGuildId = home.guildId;

    /** Every running Venue by name, home first: home always, the others as they start and stop. */
    const running = yield* SubscriptionRef.make<ReadonlyMap<VenueName, DiscordVenue>>(
      new Map([[HOME_VENUE, homeRunning]]),
    );

    /** The running Venue by this name, if it runs. */
    const venueNamed = Effect.fn("venueNamed")(function* (name: VenueName) {
      return Option.fromNullable((yield* SubscriptionRef.get(running)).get(name));
    });

    // The sandbox runs beside `pnpm dev` on the same app: only `pnpm dev` sets servers up.
    const stopVenue = sandbox
      ? () => Effect.void
      : yield* followServers(ready, homeGuildId, running, records, (message) =>
          alerts.post(message),
        );

    const interactions = Stream.asyncPush<Interaction>((emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const onInteraction = (i: Interaction) => emit.single(i);
          client.on(Events.InteractionCreate, onInteraction);
          return onInteraction;
        }),
        (onInteraction) => Effect.sync(() => client.off(Events.InteractionCreate, onInteraction)),
      ),
    ).pipe(
      Stream.mapEffect(
        (i) =>
          Effect.gen(function* () {
            const venue = [...(yield* SubscriptionRef.get(running)).values()].find((v) =>
              isIn(v, i),
            );
            if (venue !== undefined)
              return Option.some<VenueInteraction>({ interaction: i, venue });
            if (!sandbox && i.isRepliable())
              yield* tryDiscord("reply", () =>
                i.reply({ content: "Multiballs only works in its own channel.", ephemeral: true }),
              ).pipe(Effect.ignore);
            return Option.none<VenueInteraction>();
          }),
        // A reply to a click from elsewhere never holds up the clicks behind it.
        { concurrency: "unbounded", unordered: true },
      ),
      Stream.filterMap((clicked) => clicked),
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
      home: homeRunning,
      /** Every running Venue now, home first. */
      running: Effect.map(SubscriptionRef.get(running), (all) => [...all.values()]),
      /** The running Venues now, then again each time one starts or stops. */
      changes: Stream.map(running.changes, (all) => [...all.values()]),
      venueNamed,
      /**
       * A running Venue's channel is gone (deleted by hand): it stops running, so clicks, pings and
       * the Activity stop offering it, and the next retry sets it up again. Home runs on regardless.
       */
      channelGone: Effect.fn("channelGone")(function* (name: VenueName) {
        if (name === HOME_VENUE)
          return yield* Effect.logWarning("the home Venue's channel is gone");
        yield* Effect.logWarning(
          `Venue ${name}'s channel is gone; it stops until it is set up again`,
        );
        yield* stopVenue(name);
      }),
      /** Clicks from every running Venue's channel and its Match Threads, each with its Venue. */
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
