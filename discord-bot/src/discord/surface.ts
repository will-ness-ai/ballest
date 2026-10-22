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
import { Context, Effect, Layer, Option, Ref, Schedule, Schema, Stream } from "effect";
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
import { type Channel, type ChannelError, Drawing, VenueChannels } from "./channel.js";
import { describeDiscordError } from "./client.js";

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

/** How soon a Venue whose channel couldn't start is tried again. */
const RETRY_EVERY = "1 minute";

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

const logFailure = (e: ChannelError) =>
  e._tag === "Gone"
    ? Effect.logWarning(`${e.id} is gone`)
    : e._tag === "RenderError"
      ? Effect.logError("drawing an image failed", e.cause)
      : Effect.logError(`discord ${describeDiscordError(e)}`);

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

/** One Venue's channel as a Surface: its Footer, Cards and Match Threads, and its layout row. */
const venueSurface = Effect.fn("venueSurface")(function* (venue: VenueName, channel: Channel) {
  const sql = yield* SqlClient.SqlClient;

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
    Effect.catchAll((e) => logFailure(e)),
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
    Effect.catchAll((e) => logFailure(e)),
  );

  // Startup: the Footer must be the channel's last message, with today's wording, and is edited
  // only if this build draws it differently.
  // If the newest message can't be read, the Footer is assumed still last rather than reposted.
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
      if (footerId !== null) yield* channel.deleteMessage(footerId).pipe(ignoreGone);
      yield* postFooter();
    }
  });
  // Home runs whatever its channel says, as it always has; another Venue whose Footer can't be put
  // right doesn't start (nobody could open a Match there), and is tried again.
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
 * Venue, and a post or removal to the Venue whose channel holds that Match's Card. A Venue that
 * starts while the bot runs gets its Footer at once; one that stops is drawn no more.
 */
const make = Effect.gen(function* () {
  const channels = yield* VenueChannels;
  const running = new Map<
    VenueName,
    {
      readonly channel: Channel;
      readonly surface: Effect.Effect.Success<ReturnType<typeof venueSurface>>;
    }
  >();
  const surfaces = () => [...running.values()].map((r) => r.surface);

  /** The running Venues' channels as last heard, so a Venue that couldn't start is tried again. */
  const latest = yield* Ref.make<ReadonlyMap<VenueName, Channel>>(new Map());
  const once = yield* Effect.makeSemaphore(1);

  /**
   * Start the Surface of each Venue new to the set (or back in a new channel), and of any that
   * couldn't start before; drop the rest. Each Venue starts on its own: one that can't leaves the
   * others to start.
   */
  const follow = Effect.fn("follow")(function* () {
    const now = yield* Ref.get(latest);
    for (const venue of [...running.keys()])
      if (!now.has(venue)) {
        running.delete(venue);
        yield* Effect.log(`Venue ${venue} stopped: its channel is drawn no more`);
      }
    // In order, home first: each start's Footer check is a few Discord calls.
    for (const [venue, channel] of now)
      if (running.get(venue)?.channel !== channel) {
        running.delete(venue);
        const started = yield* venueSurface(venue, channel).pipe(Effect.option);
        if (Option.isSome(started)) running.set(venue, { channel, surface: started.value });
        else yield* Effect.logWarning(`Venue ${venue} can't start its channel yet; trying again`);
      }
  }, once.withPermits(1));
  yield* Ref.set(latest, yield* channels.now);
  yield* follow();
  yield* channels.changes.pipe(
    Stream.runForEach((now) => Ref.set(latest, now).pipe(Effect.zipRight(follow()))),
    Effect.forkScoped,
  );
  yield* follow().pipe(
    Effect.repeat(Schedule.spaced(RETRY_EVERY)),
    Effect.delay(RETRY_EVERY),
    Effect.forkScoped,
  );

  /** The Venue Surface holding a Match's Card, if any. */
  const holding = Effect.fn("holding")(function* (matchId: string) {
    return yield* Effect.findFirst(surfaces(), (s) => s.holds(matchId));
  });

  const showCard = Effect.fn("Surface.showCard")(function* (view: CardView) {
    const surface = running.get(view.venue)?.surface;
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
      const surface = running.get(venue)?.surface;
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
 * VenueChannels and a SqlClient.
 */
export const ChannelSurfaceLive = Layer.scopedContext(make).pipe(Layer.provide(MigratorLive));
