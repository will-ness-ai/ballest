// The Surface port on each Venue's Channel: where each Card, its Match Thread and the Footer sit,
// kept in SQLite (a layout row per Venue) so a restart picks up where it left off. Channel
// failures are logged, never thrown at the engine: a Card that fails to redraw must not stop a
// Match.
//
// Each Venue's channel follows the same rules on its own (spec #315): a Card goes to its Match's
// Venue, and everything after it to wherever that Card is.
//
// The rules (spec #21, stories 19-22, 31, 38):
// - The Footer is always the channel's last message.
// - A restart edits the Footer only when this build draws it differently: Discord shows any edit
//   to the channel's last message as new activity there.
// - The channel holds only Cards and the Footer; the Channel deletes Discord's "started a
//   thread" notices.
// - A new Card is made by editing the Footer into it, then posting a fresh Footer, so Cards read
//   top to bottom in the order their Invites opened. If the Footer was deleted by hand, the Card
//   is posted fresh. If the Card can't be drawn at all, no Footer is posted above the gap.
// - Except a Lobby's (spec #87, changing the rule above for Lobbies): its Card pings
//   @Multiplayer ping, and Discord only notifies a mention on the post that creates a message,
//   never on an edit. So a Lobby's Card is posted fresh, the old Footer deleted and a new Footer
//   posted, which keeps the same order with the Footer last. The Channel lets a posted Card
//   mention the role; a redraw never does.
// - An expired, cancelled or declined Invite loses its Card and its Match Thread. One cancelled
//   because no Map is eligible, or a live Match everyone left before setting a time, keeps both,
//   its Card saying why, so every Player can see it.
// - A Match Thread opens with a clock: when the Invite expires, then when the Match ends, as a
//   Discord timestamp, redrawn as the Match moves on.
// - A Match Thread that fails to start is started on the Match's next thread post.
// - A Card is forgotten once it will never change again: after its Result, or once removed.
//   A finished Match's place is still kept (the most recent ones), for the Activity's links.
import { SqlClient, SqlSchema } from "@effect/sql";
import { Cause, Context, Effect, Exit, Fiber, Layer, Option, Ref, Schema } from "effect";
import { attempt } from "../attempt.js";
import { MigratorLive } from "../db.js";
import { HOME_VENUE, type VenueName } from "../domain.js";
import {
  type CardView,
  isKept,
  MatchLinks,
  type MatchPlace,
  type RemovalReason,
  Surface,
  type ThreadPost,
} from "../ports.js";
import { Guests } from "../guests.js";
import { OpsAlerts } from "../ops.js";
import { type Channel, type ChannelError, Drawing, VenueChannels } from "./channel.js";
import { describeDiscordError, DiscordError, hasCode, UNKNOWN_CHANNEL } from "./client.js";

interface CardRef {
  readonly messageId: string;
  /** Null until the Match Thread has started. */
  readonly threadId: string | null;
  /** The clock that opens the Match Thread; null until it's posted. */
  readonly clockId: string | null;
}

interface Layout {
  readonly footerId: string | null;
  /** The fingerprint of what the Footer shows; null when unknown, so the next start redraws it. */
  readonly footerFingerprint: string | null;
  readonly cards: ReadonlyMap<string, CardRef>;
  /** Where finished Matches' Cards and threads are in this channel, oldest first. */
  readonly finished: ReadonlyMap<string, MatchPlace>;
}

/** How long the engine waits on a guest Venue's channel starting; it runs whenever it does. */
const START_TIMEOUT = "30 seconds";

/** How soon a guest Venue whose Footer couldn't be put right is tried again, in place. */
const RETRY_FOOTER = "5 minutes";

/** How long one try at starting a guest Venue's channel may take before it counts as failed. */
const ATTEMPT_LIMIT = "60 seconds";

/** How many finished Matches' places are kept. */
const FINISHED_KEPT = 100;

const LayoutJson = Schema.parseJson(
  Schema.Struct({
    footerId: Schema.NullOr(Schema.String),
    footerFingerprint: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
    cards: Schema.Array(
      Schema.Tuple(
        Schema.String,
        Schema.Struct({
          messageId: Schema.String,
          threadId: Schema.NullOr(Schema.String),
          clockId: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
        }),
      ),
    ),
    finished: Schema.optionalWith(
      Schema.Array(
        Schema.Tuple(
          Schema.String,
          Schema.Struct({ messageId: Schema.String, threadId: Schema.NullOr(Schema.String) }),
        ),
      ),
      { default: () => [] },
    ),
  }),
);

/** A channel failure in a few words, for ops. */
const describeFailure = (e: ChannelError) =>
  e._tag === "Gone"
    ? `${e.id} is gone`
    : e._tag === "RenderError"
      ? "drawing an image failed"
      : `discord ${describeDiscordError(e)}`;

const logFailure = (e: ChannelError) =>
  e._tag === "Gone"
    ? Effect.logWarning(describeFailure(e))
    : e._tag === "RenderError"
      ? Effect.logError(describeFailure(e), e.cause)
      : Effect.logError(describeFailure(e));

/** Try a Channel call up to twice more, unless what it acts on is gone. */
const retryUnlessGone = <A, E extends ChannelError>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.retry({ times: 2, while: (e: E) => e._tag !== "Gone" }));

/** Something already gone counts as done, and any other failure is the caller's. */
const ignoreGone = <A, E extends ChannelError>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.catchIf(
      (e) => e._tag === "Gone",
      () => Effect.void,
    ),
  );

/** Deleting or closing something already gone counts as done. */
const unlessGone = <E extends ChannelError>(effect: Effect.Effect<void, E>) =>
  effect.pipe(Effect.catchAll((e) => (e._tag === "Gone" ? Effect.void : logFailure(e))));

/**
 * One Venue's channel as a Surface: its Footer, Cards and Match Threads, and its layout row.
 * `channelGone` reports the channel itself was deleted (Discord's Unknown Channel): ops is told,
 * and a guest Venue is set up again with a new channel, the bot restarting to run it.
 */
const venueSurface = Effect.fn("venueSurface")(function* (
  venue: VenueName,
  channel: Channel,
  channelGone: Effect.Effect<void>,
) {
  const sql = yield* SqlClient.SqlClient;
  /** Log a failure that ends a draw, and tell ops when the channel is gone. */
  const failed = (e: ChannelError) =>
    e._tag === "DiscordError" && hasCode(e, UNKNOWN_CHANNEL)
      ? logFailure(e).pipe(Effect.zipRight(channelGone))
      : logFailure(e);

  const loadLayout = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ data: LayoutJson }),
    execute: () => sql`SELECT data FROM venue_layouts WHERE venue = ${venue}`,
  });
  const saved = yield* loadLayout(undefined).pipe(Effect.orDie);
  const layout = yield* Ref.make<Layout>(
    Option.match(saved, {
      onNone: () => ({
        footerId: null,
        footerFingerprint: null,
        cards: new Map(),
        finished: new Map(),
      }),
      onSome: ({ data }) => ({
        footerId: data.footerId,
        footerFingerprint: data.footerFingerprint,
        cards: new Map(data.cards),
        finished: new Map(data.finished),
      }),
    }),
  );
  const setLayout = Effect.fn("setLayout")(function* (change: (current: Layout) => Layout) {
    const next = yield* Ref.updateAndGet(layout, (current) => change(current));
    const data = yield* Schema.encode(LayoutJson)({
      footerId: next.footerId,
      footerFingerprint: next.footerFingerprint,
      cards: [...next.cards],
      finished: [...next.finished],
    });
    yield* sql`INSERT INTO venue_layouts (venue, data) VALUES (${venue}, ${data}) ON CONFLICT (venue) DO UPDATE SET data = excluded.data`;
  }, Effect.orDie);
  const setCard = (matchId: string, card: CardRef) =>
    setLayout((l) => ({ ...l, cards: new Map(l.cards).set(matchId, card) }));
  const setFooter = (footerId: string | null, footerFingerprint: string | null) =>
    setLayout((l) => ({ ...l, footerId, footerFingerprint }));

  /** What this build's Footer looks like, or null if it can't be drawn (then it's redrawn next start). */
  const thisBuildsFooter = channel.fingerprint(Drawing.Footer()).pipe(
    Effect.tapError((e) => logFailure(e)),
    Effect.orElseSucceed(() => null),
  );
  const postFooter = Effect.fn("postFooter")(function* () {
    const fingerprint = yield* thisBuildsFooter;
    yield* setFooter(yield* channel.post(Drawing.Footer()), fingerprint);
  });

  /** The latest view of each Card, only to name a Match Thread started late. */
  const views = yield* Ref.make(new Map<string, CardView>());
  /** What each thread's clock last showed, so it is only redrawn when that changes. */
  const clocks = yield* Ref.make(new Map<string, string>());

  /** Stop tracking a Card; `finished` keeps where it was, for links. */
  const forget = Effect.fn("forget")(function* (matchId: string, finished = false) {
    const without = <V>(m: Map<string, V>) => {
      const next = new Map(m);
      next.delete(matchId);
      return next;
    };
    yield* Ref.update(views, (m) => without(m));
    yield* Ref.update(clocks, (m) => without(m));
    yield* setLayout((l) => {
      const card = l.cards.get(matchId);
      const cards = new Map(l.cards);
      cards.delete(matchId);
      if (!finished || card === undefined) return { ...l, cards };
      const kept = new Map(l.finished).set(matchId, {
        messageId: card.messageId,
        threadId: card.threadId,
      });
      for (const key of kept.keys()) if (kept.size > FINISHED_KEPT) kept.delete(key);
      return { ...l, cards, finished: kept };
    });
  });

  const lock = yield* Effect.makeSemaphore(1);

  const clockKey = (view: CardView) => `${view.state}:${view.expiresAt}:${view.endsAt}`;

  /** Start a Card's Match Thread, retrying twice, and open it with the clock. None if it won't start. */
  const startThread = Effect.fn("startThread")(function* (
    matchId: string,
    messageId: string,
    view: CardView,
  ) {
    const threadId = yield* retryUnlessGone(channel.startThread(messageId, view)).pipe(
      Effect.tapError((e) => logFailure(e)),
      Effect.option,
    );
    if (Option.isNone(threadId)) return threadId;
    const clockId = yield* channel.postClock(threadId.value, view).pipe(
      Effect.tapError((e) => logFailure(e)),
      Effect.option,
    );
    if (Option.isSome(clockId))
      yield* Ref.update(clocks, (m) => new Map(m).set(matchId, clockKey(view)));
    yield* setCard(matchId, {
      messageId,
      threadId: threadId.value,
      clockId: Option.getOrNull(clockId),
    });
    return threadId;
  });

  /** Redraw a thread's clock when the Match has moved on, or post it if that failed before. */
  const redrawClock = Effect.fn("redrawClock")(function* (
    matchId: string,
    card: CardRef,
    view: CardView,
  ) {
    const { threadId, clockId } = card;
    if (threadId === null) return;
    const key = clockKey(view);
    if ((yield* Ref.get(clocks)).get(matchId) === key) return;
    if (clockId === null) {
      const posted = yield* channel.postClock(threadId, view).pipe(
        Effect.tapError((e) => logFailure(e)),
        Effect.option,
      );
      if (Option.isNone(posted)) return;
      yield* setCard(matchId, { ...card, clockId: posted.value });
    } else yield* unlessGone(channel.redrawClock(threadId, clockId, view));
    yield* Ref.update(clocks, (m) => new Map(m).set(matchId, key));
  });

  /**
   * A new Card, then a new Footer below it. A Lobby's Card is posted fresh, so its ping notifies,
   * and the old Footer is deleted; any other Card takes the Footer's place (or is posted fresh if
   * the Footer is gone).
   */
  const createCard = Effect.fn("createCard")(function* (view: CardView) {
    const { footerId } = yield* Ref.get(layout);
    // Forget what the Footer shows before drawing over it: if the bot stops before this Card is
    // recorded, the next start redraws the Footer rather than trusting a fingerprint it no longer has.
    if (footerId !== null) yield* setFooter(footerId, null);
    const card = Drawing.Card({ view });
    const messageId =
      footerId === null || view.type === "lobby"
        ? yield* channel.post(card)
        : yield* channel.redraw(footerId, card).pipe(
            Effect.as(footerId),
            Effect.catchTag("Gone", () => channel.post(card)),
          );
    if (footerId !== null && footerId !== messageId)
      yield* unlessGone(retryUnlessGone(channel.deleteMessage(footerId)));
    yield* setFooter(null, null);
    yield* setCard(view.matchId, { messageId, threadId: null, clockId: null });
    yield* startThread(view.matchId, messageId, view);
    yield* postFooter();
  });

  const showCard = Effect.fn("showCard")(
    function* (view: CardView) {
      yield* Ref.update(views, (m) => new Map(m).set(view.matchId, view));
      const card = (yield* Ref.get(layout)).cards.get(view.matchId);
      if (card === undefined) return yield* createCard(view);
      yield* channel.redraw(card.messageId, Drawing.Card({ view }));
      yield* redrawClock(view.matchId, card, view);
    },
    Effect.catchAll((e) => failed(e)),
    lock.withPermits(1),
  );

  const remove = Effect.fn("remove")(function* (matchId: string, reason: RemovalReason) {
    const card = (yield* Ref.get(layout)).cards.get(matchId);
    if (card === undefined) return;
    if (isKept(reason)) {
      yield* unlessGone(channel.redraw(card.messageId, Drawing.Closed({ reason })));
      if (card.threadId !== null && card.clockId !== null)
        yield* unlessGone(channel.redrawClock(card.threadId, card.clockId, "cancelled"));
    } else {
      if (card.threadId !== null) yield* unlessGone(channel.deleteThread(card.threadId));
      yield* unlessGone(channel.deleteMessage(card.messageId));
    }
    yield* forget(matchId);
  }, lock.withPermits(1));

  /** A Match's thread, started now if it couldn't be when its Card was drawn. */
  const threadOf = Effect.fn("threadOf")(function* (matchId: string) {
    const card = (yield* Ref.get(layout)).cards.get(matchId);
    if (card === undefined) return Option.none<string>();
    if (card.threadId !== null) return Option.some(card.threadId);
    const view = (yield* Ref.get(views)).get(matchId);
    return view === undefined
      ? Option.none<string>()
      : yield* startThread(matchId, card.messageId, view);
  }, lock.withPermits(1));

  const post = Effect.fn("post")(
    function* (matchId: string, post: ThreadPost) {
      const threadId = yield* threadOf(matchId);
      if (Option.isNone(threadId))
        return yield* Effect.logWarning(`no thread for ${matchId}; dropped a ${post._tag} post`);
      yield* channel.postInThread(threadId.value, matchId, post);
      // The last thing a Match's thread gets: the graph after the Result, or the Result when nobody set a time.
      const last =
        post._tag === "Progression" ||
        (post._tag === "Result" && post.standings.every((s) => s.ticks === null));
      if (last) yield* lock.withPermits(1)(forget(matchId, true));
    },
    Effect.catchAll((e) => failed(e)),
  );

  // Startup: the Footer must be the channel's last message, with today's wording, and is edited
  // only if this build draws it differently.
  // If the newest message can't be read, the Footer is assumed still last rather than reposted.
  // An old Footer that can't be deleted: home logs it and posts anyway, as it always has; another
  // Venue is left out rather than show two Footers.
  const startFooter = Effect.gen(function* () {
    const { footerId, footerFingerprint } = yield* Ref.get(layout);
    const last = yield* channel.lastMessageId.pipe(
      Effect.tapError((e) => logFailure(e)),
      Effect.orElseSucceed(() => footerId),
    );
    if (footerId !== null && footerId === last) {
      const fingerprint = yield* thisBuildsFooter;
      if (fingerprint === null || fingerprint !== footerFingerprint)
        yield* channel
          .redraw(footerId, Drawing.Footer())
          .pipe(Effect.andThen(setFooter(footerId, fingerprint)), ignoreGone);
    } else {
      if (footerId !== null)
        yield* venue === HOME_VENUE
          ? unlessGone(channel.deleteMessage(footerId))
          : ignoreGone(channel.deleteMessage(footerId));
      yield* postFooter();
    }
  });
  // Home runs whatever its channel says, as it always has; another Venue whose Footer can't be put
  // right doesn't start (nobody could open a Match there) until it is repaired.
  yield* venue === HOME_VENUE
    ? startFooter.pipe(Effect.catchAll((e) => logFailure(e)))
    : startFooter.pipe(Effect.tapError((e) => logFailure(e)));

  /** Where this channel holds a Match's Card and thread, live or finished. */
  const placeOf = Effect.fn("placeOf")(function* (matchId: string) {
    const { cards, finished } = yield* Ref.get(layout);
    const card = cards.get(matchId);
    const spot =
      card === undefined
        ? finished.get(matchId)
        : { messageId: card.messageId, threadId: card.threadId };
    return Option.fromNullable(spot);
  });

  /** Whether this channel holds the Match's Card now, so its posts and removal come here. */
  const holds = Effect.fn("holds")(function* (matchId: string) {
    return (yield* Ref.get(layout)).cards.has(matchId);
  });

  return { showCard, remove, post, placeOf, holds };
});

/**
 * Every running Venue's channel Surface behind the one Surface port: a Card goes to its view's
 * Venue, and a post or removal to the Venue whose channel holds that Match's Card. Each Venue
 * starts here, home first, before the engine's restart recovery redraws any Card.
 */
const make = Effect.gen(function* () {
  const channels = yield* VenueChannels;
  const alerts = yield* OpsAlerts;
  const guests = yield* Guests;
  const running = new Map<VenueName, Effect.Effect.Success<ReturnType<typeof venueSurface>>>();
  const surfaces = () => [...running.values()];

  /** Ops hears once that a Venue's channel is gone; a guest's breaks, to be repaired. */
  const channelGone = (venue: VenueName) =>
    alerts
      .post(
        venue === HOME_VENUE
          ? "Multiballs can't find its home channel (deleted?). Check DISCORD_CHANNEL_ID."
          : `Multiballs can't find the Venue ${venue}'s channel (deleted?). It makes a new one within a few minutes and restarts to run it.`,
        { key: `channel ${venue}`, kind: "gone" },
      )
      .pipe(Effect.zipRight(guests.broke(venue)));

  const scope = yield* Effect.scope;
  const sql = yield* SqlClient.SqlClient;
  /** The guest Venues with a start running, even one past its time limit: a retry waits its turn. */
  const busy = new Set<string>();

  /**
   * Start a guest Venue on its own, in the background; the engine waits on it at most
   * START_TIMEOUT, and it runs, and is offered (`Guests.up`), whenever its start succeeds. Each
   * try may take ATTEMPT_LIMIT: past it the try counts as failed, though what it was doing (its
   * Footer's post, the write of its id) runs on, never interrupted, and no other try starts till
   * it ends. One whose Footer can't be put right, that takes too long or hits a bug is told to ops
   * once and tried again in place every RETRY_FOOTER: setup has nothing to repair there, so it is
   * not broken and the bot doesn't restart. One whose channel is gone is broken, for setup to
   * repair.
   */
  const startGuest = Effect.fn("startGuest")(function* (venue: VenueName, channel: Channel) {
    const gone = channelGone(venue);
    const again = (): Effect.Effect<void> =>
      Effect.suspend(tryOnce).pipe(Effect.delay(RETRY_FOOTER), Effect.forkIn(scope), Effect.asVoid);
    const tryOnce = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const tried = yield* attempt(venueSurface(venue, channel, gone), {
          key: venue,
          busy,
          limit: ATTEMPT_LIMIT,
          onTimeout: () =>
            new DiscordError({ op: "start", cause: `timed out after ${ATTEMPT_LIMIT}` }),
          alerts,
          tell: (cause) =>
            Option.match(Cause.failureOption(cause), {
              onNone: () => Option.some("a bug, see the log"),
              onSome: (e) =>
                e._tag === "DiscordError" && hasCode(e, UNKNOWN_CHANNEL)
                  ? Option.none()
                  : Option.some(describeFailure(e)),
            }).pipe(
              Option.map((why) => ({
                kind: "footer",
                message: `Multiballs left the Venue ${venue} out: its Footer couldn't be put right (${why}). It tries again every five minutes.`,
              })),
            ),
        });
        // A try still running: wait for the next turn.
        if (Option.isNone(tried)) return yield* again();
        const started = tried.value;
        if (Exit.isSuccess(started)) {
          running.set(venue, started.value);
          return yield* guests.up(venue);
        }
        const failure = Cause.failureOption(started.cause);
        if (
          Option.isSome(failure) &&
          failure.value._tag === "DiscordError" &&
          hasCode(failure.value, UNKNOWN_CHANNEL)
        )
          return yield* gone;
        yield* again();
      }).pipe(Effect.provideService(SqlClient.SqlClient, sql));
    const first = yield* Effect.forkIn(tryOnce(), scope);
    const settled = yield* Fiber.await(first).pipe(Effect.timeout(START_TIMEOUT), Effect.option);
    if (Option.isNone(settled))
      yield* Effect.logWarning(`Venue ${venue}'s channel is slow to start; it runs once it does`);
  });

  // Home first, as it always has: its start never fails, and a bug in it is the bot's. The guests
  // then start side by side, so the engine waits at most START_TIMEOUT on them.
  const home = channels.all.get(HOME_VENUE);
  if (home !== undefined)
    running.set(HOME_VENUE, yield* venueSurface(HOME_VENUE, home, channelGone(HOME_VENUE)));
  yield* Effect.forEach(
    [...channels.all].filter(([venue]) => venue !== HOME_VENUE),
    ([venue, channel]) => startGuest(venue, channel),
    { concurrency: "unbounded", discard: true },
  );

  /** The Venue Surface holding a Match's Card, if any. */
  const holding = Effect.fn("holding")(function* (matchId: string) {
    return yield* Effect.findFirst(surfaces(), (s) => s.holds(matchId));
  });

  const showCard = Effect.fn("Surface.showCard")(function* (view: CardView) {
    const surface = running.get(view.venue);
    if (surface === undefined)
      return yield* Effect.logWarning(
        `Venue ${view.venue} isn't running; ${view.matchId}'s Card isn't drawn`,
      );
    yield* surface.showCard(view);
  });
  const post = Effect.fn("Surface.post")(function* (matchId: string, threadPost: ThreadPost) {
    const surface = yield* holding(matchId);
    if (Option.isNone(surface))
      return yield* Effect.logWarning(`no Card for ${matchId}; dropped a ${threadPost._tag} post`);
    yield* surface.value.post(matchId, threadPost);
  });
  const remove = Effect.fn("Surface.remove")(function* (matchId: string, reason: RemovalReason) {
    const surface = yield* holding(matchId);
    if (Option.isSome(surface)) yield* surface.value.remove(matchId, reason);
  });

  const links = MatchLinks.of({
    of: Effect.fn("MatchLinks.of")(function* (venue: VenueName, matchId: string) {
      const surface = running.get(venue);
      return surface === undefined ? Option.none<MatchPlace>() : yield* surface.placeOf(matchId);
    }),
  });

  const runs = (venue: VenueName) => running.has(venue);

  return Context.make(Surface, Surface.of({ runs, showCard, remove, post })).pipe(
    Context.add(MatchLinks, links),
  );
});

/**
 * The Surface port on every running Venue's Channel, and where each put each Match. Needs the
 * VenueChannels, Guests, OpsAlerts and a SqlClient.
 */
export const ChannelSurfaceLive = Layer.scopedContext(make).pipe(Layer.provide(MigratorLive));
