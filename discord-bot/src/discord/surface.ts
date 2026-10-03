// The Surface port on a Channel: where each Card, its Match Thread and the Footer sit, kept in
// SQLite so a restart picks up where it left off. Channel failures are logged, never thrown at
// the engine: a Card that fails to redraw must not stop a Match.
//
// The rules (spec #21, stories 19-22, 31, 38):
// - The Footer is always the channel's last message.
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
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import { MigratorLive } from "../db.js";
import {
  type CardView,
  isKept,
  MatchLinks,
  type MatchPlace,
  type RemovalReason,
  Surface,
  type ThreadPost,
} from "../ports.js";
import { Channel, type ChannelError, Drawing } from "./channel.js";
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
  readonly cards: ReadonlyMap<string, CardRef>;
  /** Where finished Matches' Cards and threads are, oldest first. */
  readonly finished: ReadonlyMap<string, MatchPlace>;
}

/** How many finished Matches' places are kept. */
const FINISHED_KEPT = 100;

const LayoutJson = Schema.parseJson(
  Schema.Struct({
    footerId: Schema.NullOr(Schema.String),
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

/** Deleting or closing something already gone counts as done. */
const unlessGone = <E extends ChannelError>(effect: Effect.Effect<void, E>) =>
  effect.pipe(Effect.catchAll((e) => (e._tag === "Gone" ? Effect.void : logFailure(e))));

const make = Effect.gen(function* () {
  const channel = yield* Channel;
  const sql = yield* SqlClient.SqlClient;

  const loadLayout = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ data: LayoutJson }),
    execute: () => sql`SELECT data FROM discord_layout WHERE id = 1`,
  });
  const saved = yield* loadLayout(undefined).pipe(Effect.orDie);
  const layout = yield* Ref.make<Layout>(
    Option.match(saved, {
      onNone: () => ({ footerId: null, cards: new Map(), finished: new Map() }),
      onSome: ({ data }) => ({
        footerId: data.footerId,
        cards: new Map(data.cards),
        finished: new Map(data.finished),
      }),
    }),
  );
  const setLayout = Effect.fn("setLayout")(function* (change: (current: Layout) => Layout) {
    const next = yield* Ref.updateAndGet(layout, (current) => change(current));
    const data = yield* Schema.encode(LayoutJson)({
      footerId: next.footerId,
      cards: [...next.cards],
      finished: [...next.finished],
    });
    yield* sql`INSERT INTO discord_layout (id, data) VALUES (1, ${data}) ON CONFLICT (id) DO UPDATE SET data = excluded.data`;
  }, Effect.orDie);
  const setCard = (matchId: string, card: CardRef) =>
    setLayout((l) => ({ ...l, cards: new Map(l.cards).set(matchId, card) }));
  const setFooter = (footerId: string | null) => setLayout((l) => ({ ...l, footerId }));

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
    yield* setFooter(null);
    yield* setCard(view.matchId, { messageId, threadId: null, clockId: null });
    yield* startThread(view.matchId, messageId, view);
    yield* setFooter(yield* channel.post(Drawing.Footer()));
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

  // Startup: the Footer must be the channel's last message, with today's wording.
  const { footerId } = yield* Ref.get(layout);
  const last = yield* channel.lastMessageId.pipe(Effect.orElseSucceed(() => null));
  if (footerId !== null && footerId === last)
    yield* unlessGone(channel.redraw(footerId, Drawing.Footer()));
  else {
    if (footerId !== null) yield* unlessGone(channel.deleteMessage(footerId));
    yield* channel.post(Drawing.Footer()).pipe(
      Effect.flatMap((id) => setFooter(id)),
      Effect.catchAll((e) => logFailure(e)),
    );
  }

  const links = MatchLinks.of({
    of: (matchId) =>
      Ref.get(layout).pipe(
        Effect.map(({ cards, finished }) => {
          const card = cards.get(matchId);
          return Option.fromNullable(
            card === undefined
              ? finished.get(matchId)
              : { messageId: card.messageId, threadId: card.threadId },
          );
        }),
      ),
  });

  return Context.make(Surface, Surface.of({ showCard, remove, post })).pipe(
    Context.add(MatchLinks, links),
  );
});

/** The Surface port on a Channel, and where it put each Match. Needs the Channel and a SqlClient. */
export const ChannelSurfaceLive = Layer.effectContext(make).pipe(Layer.provide(MigratorLive));
