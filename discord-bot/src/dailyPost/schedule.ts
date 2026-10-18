// The Daily Post (spec #268): from 01:00 UTC Multiballs asks the developers' Daily API for
// today's Daily every minute until it answers, posts its card in DAILY_CHANNEL_ID with a thread,
// then reads the Daily's Steam board every 15 minutes and edits the card when what it shows
// changed. The first read at or after the Daily's end is its last. Each Daily Post is recorded in
// the bot's SQLite, so a restart resumes the live one and never posts a date twice, and so is
// each read that changed the lead: it redraws the card's lead graph and gets a line in the thread.
//
// The schedule runs over ports (the Daily API, the Daily's Steam reads, the channel, the record),
// so it is tested on the TestClock over fakes; the real adapters are in live.ts.
import { SqlClient } from "@effect/sql";
import {
  Cause,
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Either,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { MigratorLive } from "../db.js";
import { OpsAlerts } from "../ops.js";
import type { SteamUnavailable } from "../ports.js";
import { MapPreviews } from "../previews.js";
import { Renderer } from "../render/renderer.js";
import {
  type BoardRead,
  type Daily,
  type DailyMap,
  shownKey,
  threadName,
  type DailyView,
  viewOf,
} from "./card.js";
import { addDays, dailyDateAt, openingOf } from "./date.js";
import { DailyHistory, type PastDaily } from "./history.js";
import { type Lead, leadChanged, leadLine, leadOf } from "./lead.js";
import {
  type DailyCard,
  dailyCard,
  dailyLineMessage,
  type DailyLine,
  type Picture,
} from "./messages.js";
import { DailySpins, SPIN_WAIT, type SpinUnavailable } from "./spin.js";

/** How often a live Daily's board is read. */
export const READ_EVERY = Duration.toMillis("15 minutes");
/** How often the API is asked for today's Daily until it answers. */
export const ASK_EVERY = Duration.toMillis("1 minute");
const HOUR = 3_600_000;

// ---------------------------------------------------------------- ports

/** The Daily API wouldn't answer, or answered something unreadable. */
export class DailyApiUnavailable extends Data.TaggedError("DailyApiUnavailable")<{
  readonly reason: string;
}> {}

/** The developers' Daily API: which Daily a date is, once it has opened. */
export class DailyApi extends Context.Tag("multiballs/DailyApi")<
  DailyApi,
  {
    /** None until that date's Daily has opened. */
    readonly find: (date: string) => Effect.Effect<Option.Option<Daily>, DailyApiUnavailable>;
  }
>() {}

/** What a Daily Post reads from Steam. */
export class DailySteam extends Context.Tag("multiballs/DailySteam")<
  DailySteam,
  {
    /** The Daily's Map, from its Workshop page. */
    readonly map: (pfid: string) => Effect.Effect<DailyMap, SteamUnavailable>;
    /** The Daily's board: ranks 1 to 3, named, and how many players it holds. */
    readonly board: (boardId: number) => Effect.Effect<BoardRead, SteamUnavailable>;
  }
>() {}

/** Nothing was posted, or the edit didn't land. */
export class DailyPostFailed extends Data.TaggedError("DailyPostFailed")<{
  readonly reason: string;
}> {}

/** The card is up, but its thread isn't. */
export class DailyThreadFailed extends Data.TaggedError("DailyThreadFailed")<{
  readonly messageId: string;
  readonly reason: string;
}> {}

/** The daily daily channel. */
export class DailyChannel extends Context.Tag("multiballs/DailyChannel")<
  DailyChannel,
  {
    /** Post a card with its files attached and open a thread on it. */
    readonly post: (
      card: DailyCard,
      threadName: string,
    ) => Effect.Effect<
      { readonly messageId: string; readonly threadId: string },
      DailyPostFailed | DailyThreadFailed
    >;
    /**
     * Redraw a card: its attachments stay, and each of its files is attached beside them,
     * replacing the one of its name.
     */
    readonly edit: (messageId: string, card: DailyCard) => Effect.Effect<void, DailyPostFailed>;
    /** Post a line in a card's thread. */
    readonly say: (threadId: string, line: DailyLine) => Effect.Effect<void, DailyPostFailed>;
  }
>() {}

// ---------------------------------------------------------------- the record

const Medals = Schema.Struct({
  bronze: Schema.Number,
  silver: Schema.Number,
  gold: Schema.Number,
  author: Schema.Number,
});

const SPIN_TO_ASK = { state: "ask", version: null, askedAt: 0 } as const;

/** One Daily Post as recorded: enough to redraw its card after a restart without the API. */
const DailyPostRecord = Schema.Struct({
  daily: Schema.Struct({
    date: Schema.String,
    pfid: Schema.String,
    title: Schema.String,
    startsAt: Schema.Number,
    endsAt: Schema.Number,
    boardId: Schema.Number,
  }),
  map: Schema.Struct({
    title: Schema.String,
    maker: Schema.String,
    previewUrl: Schema.String,
    medals: Medals,
  }),
  /** Whether the Workshop screenshot is attached to the card. */
  preview: Schema.Boolean,
  messageId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  state: Schema.Literal("live", "closed"),
  /** What the card shows now (shownKey), so an edit happens only on a change. */
  shown: Schema.String,
  /** The last read the card was drawn from or checked against. */
  readAt: Schema.Number,
  /** The spinning GIF (spin.ts): to "ask" for, "asked" for (at `askedAt`, drawn from file
   * `version`), "late" once ops heard it hadn't come, "shown" on the card, or "none" (no file). */
  spin: Schema.optionalWith(
    Schema.Struct({
      state: Schema.Literal("ask", "asked", "late", "shown", "none"),
      version: Schema.NullOr(Schema.String),
      askedAt: Schema.Number,
    }),
    { default: () => SPIN_TO_ASK },
  ),
  /** The board the closed card shows, so its GIF can be edited in after the close. */
  board: Schema.optionalWith(
    Schema.NullOr(
      Schema.Struct({
        players: Schema.Number,
        top: Schema.Array(Schema.Struct({ name: Schema.String, ticks: Schema.Number })),
      }),
    ),
    { default: () => null },
  ),
});
export type DailyPostRecord = typeof DailyPostRecord.Type;

const Row = Schema.Struct({ data: Schema.parseJson(DailyPostRecord) });
const LeadRow = Schema.Struct({
  at: Schema.Number,
  leaders: Schema.parseJson(Schema.Array(Schema.String)),
  ticks: Schema.Number,
});

export class DailyPostLog extends Context.Tag("multiballs/DailyPostLog")<
  DailyPostLog,
  {
    readonly get: (date: string) => Effect.Effect<Option.Option<DailyPostRecord>>;
    /** Every Daily Post, oldest first. */
    readonly all: Effect.Effect<ReadonlyArray<DailyPostRecord>>;
    readonly put: (post: DailyPostRecord) => Effect.Effect<void>;
    /** Each read of a Daily that changed its lead, oldest first. */
    readonly leads: (date: string) => Effect.Effect<ReadonlyArray<Lead>>;
    readonly addLead: (date: string, lead: Lead) => Effect.Effect<void>;
  }
>() {}

export const DailyPostLogLive = Layer.effect(
  DailyPostLog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decode = Schema.decodeUnknown(Schema.Array(Row));
    // The bot's own SQLite: a failure there is a defect, which the schedule reports to ops.
    return DailyPostLog.of({
      get: Effect.fn("DailyPostLog.get")(function* (date: string) {
        const rows = yield* sql`SELECT data FROM daily_posts WHERE date = ${date}`.pipe(
          Effect.flatMap(decode),
          Effect.orDie,
        );
        return Option.fromNullable(rows[0]?.data);
      }),
      all: sql`SELECT data FROM daily_posts ORDER BY date`.pipe(
        Effect.flatMap(decode),
        Effect.map((rows) => rows.map((r) => r.data)),
        Effect.orDie,
      ),
      put: Effect.fn("DailyPostLog.put")(function* (post: DailyPostRecord) {
        const data = yield* Schema.encode(Schema.parseJson(DailyPostRecord))(post).pipe(
          Effect.orDie,
        );
        yield* sql`INSERT OR REPLACE INTO daily_posts (date, state, data) VALUES (${post.daily.date}, ${post.state}, ${data})`.pipe(
          Effect.orDie,
        );
      }),
      leads: Effect.fn("DailyPostLog.leads")(function* (date: string) {
        return yield* sql`SELECT at, leaders, ticks FROM daily_leads WHERE date = ${date} ORDER BY at`.pipe(
          Effect.flatMap(Schema.decodeUnknown(Schema.Array(LeadRow))),
          Effect.orDie,
        );
      }),
      addLead: Effect.fn("DailyPostLog.addLead")(function* (date: string, lead: Lead) {
        yield* sql`INSERT INTO daily_leads (date, at, leaders, ticks) VALUES (${date}, ${lead.at}, ${JSON.stringify(lead.leaders)}, ${lead.ticks})`.pipe(
          Effect.orDie,
        );
      }),
    });
  }),
).pipe(Layer.provide(MigratorLive));

// ---------------------------------------------------------------- one Daily Post

/** Ops hears about each kind of trouble once until it clears. */
const onceUntilCleared = Effect.gen(function* () {
  const told = yield* Ref.make(new Set<string>());
  const alerts = yield* OpsAlerts;
  return {
    tell: Effect.fn("ops.tell")(function* (kind: string, content: string) {
      const first = yield* Ref.modify(told, (s): [boolean, Set<string>] =>
        s.has(kind) ? [false, s] : [true, new Set(s).add(kind)],
      );
      if (first) yield* alerts.post(content);
    }),
    clear: Effect.fn("ops.clear")(function* (kind: string) {
      yield* Ref.update(told, (s) => {
        const next = new Set(s);
        next.delete(kind);
        return next;
      });
    }),
  };
});

/** What the card shows apart from when it was updated, its lead graph included. */
const shownOf = (view: DailyView, leads: ReadonlyArray<Lead>) =>
  `${shownKey(view)}#${leads.length}`;

/** The lead graph as it stands at `at`: "now" marked while the Daily is live. */
const drawGraph = Effect.fn("drawGraph")(function* (
  daily: Daily,
  leads: ReadonlyArray<Lead>,
  at: number,
) {
  const renderer = yield* Renderer;
  return yield* renderer.leadGraph({
    opensAt: daily.startsAt,
    closesAt: daily.endsAt,
    leads,
    now: at >= daily.endsAt ? null : at,
  });
});

/**
 * A new card's pictures: the Workshop screenshot when Steam gives it, and the lead graph drawn at
 * `at` when there is a lead. A graph that can't be drawn leaves the card without one until the
 * next change redraws it.
 */
const pictures = Effect.fn("pictures")(function* (
  daily: Daily,
  map: DailyMap,
  leads: ReadonlyArray<Lead>,
  at: number,
) {
  const preview = yield* (yield* MapPreviews).of(map.previewUrl);
  const graph =
    leads.length === 0
      ? Option.none<Uint8Array>()
      : yield* drawGraph(daily, leads, at).pipe(
          Effect.tapError((e) =>
            Effect.logWarning(`daily post: no lead graph (${String(e.cause)})`),
          ),
          Effect.option,
        );
  return {
    preview: Option.getOrNull(Option.map(preview, (p) => p.body)),
    graph: Option.getOrNull(graph),
  };
});

/** A picture the card already has, or none. */
const kept = (has: boolean): Picture => (has ? "kept" : null);

/**
 * Post a card with its thread, then each of `lines` in the thread, stopping at the first refused.
 * A card whose thread failed is still that day's post: recorded (as `record`, with the ids
 * Discord gave), so it isn't posted again. Returns the record and why the thread or a line
 * failed if one did.
 */
const postCard = Effect.fn("postCard")(function* (
  view: DailyView,
  card: DailyCard,
  record: Omit<DailyPostRecord, "messageId" | "threadId">,
  lines: ReadonlyArray<string>,
) {
  const channel = yield* DailyChannel;
  const posted = yield* channel.post(card, threadName(view)).pipe(
    Effect.map(({ messageId, threadId }) => ({
      post: { ...record, messageId, threadId },
      threadFailed: Option.none<string>(),
    })),
    Effect.catchTag("DailyThreadFailed", (e) =>
      Effect.succeed({
        post: { ...record, messageId: e.messageId, threadId: null },
        threadFailed: Option.some(e.reason),
      }),
    ),
  );
  const { threadId } = posted.post;
  if (threadId === null) return posted;
  for (const line of lines) {
    const said = yield* Effect.either(channel.say(threadId, dailyLineMessage(line)));
    if (Either.isLeft(said)) return { ...posted, threadFailed: Option.some(said.left.reason) };
  }
  return posted;
});

/**
 * Post a Daily's card: its Map, a first read of its board (none if that fails: the next read
 * retries), the Workshop screenshot when Steam gives it, the lead graph once anyone has a time,
 * and a thread, with the first time's line when there is one. Records the post, and the lead the
 * card shows, so a restart resumes it. Returns the record, and why the thread or its line failed
 * if it did.
 */
export const postDaily = Effect.fn("postDaily")(function* (daily: Daily) {
  const steam = yield* DailySteam;
  const map = yield* steam.map(daily.pfid);
  const board = yield* steam.board(daily.boardId).pipe(Effect.option);
  const readAt = yield* Clock.currentTimeMillis;
  const view = viewOf(daily, map, Option.getOrNull(board), readAt);
  const lead = Option.flatMapNullable(board, (b) => leadOf(b, readAt));
  const pics = yield* pictures(daily, map, Option.toArray(lead), readAt);
  // A lead the card couldn't draw is left for the next read to record.
  const shown = Option.filter(lead, () => pics.graph !== null);
  const leads = Option.toArray(shown);
  const posted = yield* postCard(
    view,
    dailyCard(view, pics),
    {
      daily,
      map,
      preview: pics.preview !== null,
      state: "live",
      shown: shownOf(view, leads),
      readAt,
      spin: SPIN_TO_ASK,
      board: null,
    },
    leads.flatMap((l) => leadLine([], l) ?? []),
  );
  const log = yield* DailyPostLog;
  yield* log.put(posted.post);
  for (const lead of leads) yield* log.addLead(daily.date, lead);
  return posted;
});

/**
 * Post a Daily that has already closed, from the leaderboard database (the backfill): its closed
 * card, with the lead graph drawn over the whole day, and a thread telling its lead, each line
 * timed by the run's Ghost or else by the Refresh that saw it. Records the post and its lead.
 * Returns the record (closed, its GIF still to ask for) and why the thread or a line failed if
 * one did.
 */
export const postPast = Effect.fn("postPast")(function* (past: PastDaily) {
  const steam = yield* DailySteam;
  const { daily, board, leads } = past;
  const map = yield* steam.map(daily.pfid);
  const postedAt = yield* Clock.currentTimeMillis;
  const view = viewOf(daily, map, board, postedAt);
  // A lead the database first saw after the close was set by then (boards lock at the end).
  const graphed = leads.map((l) => ({ ...l, at: Math.min(l.at, daily.endsAt) }));
  const pics = yield* pictures(daily, map, graphed, daily.endsAt);
  const posted = yield* postCard(
    view,
    dailyCard(view, { ...pics, closed: true }),
    {
      daily,
      map,
      preview: pics.preview !== null,
      state: "closed",
      shown: shownOf(view, leads),
      readAt: postedAt,
      spin: SPIN_TO_ASK,
      board,
    },
    leads.flatMap(
      (lead, i) => leadLine(leads.slice(0, i), lead, lead.exact ? "read" : "byRefresh") ?? [],
    ),
  );
  const log = yield* DailyPostLog;
  yield* log.put(posted.post);
  for (const { at, leaders, ticks } of leads)
    yield* log.addLead(daily.date, { at, leaders, ticks });
  return posted;
});

/** A closed card whose spinning GIF is still to ask for or to come. */
const spinPending = (post: DailyPostRecord) =>
  post.spin.state === "ask" || post.spin.state === "asked";

/**
 * What keeping one Daily Post current needs: its record as it stands (`current`; `save` changes
 * and records it), the channel, ops, and its spinning GIF. `ask`: ask for the GIF if it is still
 * to ask for: none for a Map with no file, and no drawing when one from the same file is already
 * there; a refused ask reaches ops once and is tried again at the next read. `arrived`: the GIF,
 * once it is drawn from the file asked about or since; ops hears once if it's late. A database
 * that can't be read leaves the GIF as it was, to try again next time.
 */
const keeperOf = Effect.fn("keeperOf")(function* (start: DailyPostRecord) {
  const channel = yield* DailyChannel;
  const log = yield* DailyPostLog;
  const spins = yield* DailySpins;
  const ops = yield* onceUntilCleared;
  const current = yield* Ref.make(start);
  const { date, pfid } = start.daily;

  const save = Effect.fn("save")(function* (post: DailyPostRecord) {
    yield* Ref.set(current, post);
    yield* log.put(post);
  });
  const setSpin = Effect.fn("setSpin")(function* (spin: Partial<DailyPostRecord["spin"]>) {
    const post = yield* Ref.get(current);
    yield* save({ ...post, spin: { ...post.spin, ...spin } });
  });
  const unread = Effect.fn("unread")(function* (e: SpinUnavailable) {
    yield* Effect.logWarning(`daily post: can't read the spinning GIF for ${date}: ${e.reason}`);
  });

  /** Edit the card; a refused edit reaches ops once until one lands. Whether it landed. */
  const edit = Effect.fn("edit")(function* <R>(attempt: Effect.Effect<void, DailyPostFailed, R>) {
    const edited = yield* Effect.either(attempt);
    if (Either.isLeft(edited)) {
      yield* ops.tell(
        "edit",
        `Multiballs couldn't update the Daily Post for ${date}: ${edited.left.reason}`,
      );
      return false;
    }
    yield* ops.clear("edit");
    return true;
  });

  const ask = Effect.gen(function* () {
    if ((yield* Ref.get(current)).spin.state !== "ask") return;
    const file = yield* Effect.either(spins.fileVersion(pfid));
    if (Either.isLeft(file)) return yield* unread(file.left);
    if (Option.isNone(file.right)) return yield* setSpin({ state: "none", version: null });
    const version = file.right.value;
    const latest = yield* Effect.either(spins.latest(pfid));
    if (Either.isLeft(latest)) return yield* unread(latest.left);
    if (!Option.exists(latest.right, (s) => s.version === version)) {
      const asked = yield* Effect.either(spins.draw(pfid));
      if (Either.isLeft(asked))
        return yield* ops.tell(
          "spin",
          `Multiballs couldn't start drawing the spinning GIF for the Daily for ${date}: ${asked.left.reason}`,
        );
      yield* ops.clear("spin");
      yield* Effect.logInfo(`daily post: asked for the spinning GIF of ${pfid}`);
    }
    yield* setSpin({ state: "asked", version, askedAt: yield* Clock.currentTimeMillis });
  });

  const arrived = Effect.gen(function* () {
    const { state, version, askedAt } = (yield* Ref.get(current)).spin;
    if (state !== "asked" && state !== "late") return Option.none<Uint8Array>();
    const latest = yield* Effect.either(spins.latest(pfid));
    if (Either.isLeft(latest)) {
      yield* unread(latest.left);
      return Option.none<Uint8Array>();
    }
    const gif = Option.filterMap(latest.right, (s) =>
      s.version === version || s.drawnAt >= askedAt ? Option.some(s.gif) : Option.none(),
    );
    if (Option.isNone(gif) && state === "asked") {
      if ((yield* Clock.currentTimeMillis) >= askedAt + SPIN_WAIT) {
        yield* ops.tell(
          "late",
          `Multiballs has no spinning GIF for the Daily for ${date} an hour after asking for it (daily-spin.yml); the card stays without it.`,
        );
        yield* setSpin({ state: "late" });
      }
    }
    return gif;
  });

  return { current, save, setSpin, edit, ops, channel, log, spin: { ask, arrived } };
});
type Keeper = Effect.Effect.Success<ReturnType<typeof keeperOf>>;

/**
 * Run `step` at `firstAt`, then again at the moment `nextAfter` gives from each run's start, until
 * a step says it is done.
 */
const onSchedule = Effect.fn("onSchedule")(function* <E, R>(
  firstAt: number,
  nextAfter: (at: number) => number,
  step: (at: number) => Effect.Effect<boolean, E, R>,
) {
  let nextAt = firstAt;
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    if (nextAt > now) yield* Effect.sleep(nextAt - now);
    const at = yield* Clock.currentTimeMillis;
    nextAt = nextAfter(at);
    if (yield* step(at)) return;
  }
});

/**
 * Keep a live Daily Post's card current: a read every READ_EVERY from its last one, and one at
 * the Daily's end, which is its last. A failed read keeps the card as it was and is retried at
 * the next. Its spinning GIF is asked for at once (spin.ts), and edited in at the first read
 * after it is drawn; one still to come at the close is waited for as a closed card's.
 */
export const keepCurrent = Effect.fn("keepCurrent")(function* (start: DailyPostRecord) {
  const steam = yield* DailySteam;
  const k = yield* keeperOf(start);
  const { daily, map } = start;
  const date = daily.date;

  yield* k.spin.ask;
  yield* onSchedule(
    Math.min(start.readAt + READ_EVERY, daily.endsAt),
    (at) => (at >= daily.endsAt ? at + READ_EVERY : Math.min(at + READ_EVERY, daily.endsAt)),
    (at) =>
      Effect.gen(function* () {
        const read = yield* Effect.either(steam.board(daily.boardId));
        if (Either.isLeft(read)) {
          yield* k.ops.tell(
            "read",
            `Multiballs couldn't read the board of the Daily for ${date}: ${read.left.reason}`,
          );
          return false;
        }
        yield* k.ops.clear("read");
        yield* k.spin.ask;
        const gif = yield* k.spin.arrived;
        const post = yield* Ref.get(k.current);
        const view = viewOf(daily, map, read.right, at);
        // A changed lead is recorded only once the card shows it, so a refused edit is tried again.
        const history = yield* k.log.leads(date);
        // Boards lock at the end, so a lead first seen after it was set by then.
        const lead = leadOf(read.right, Math.min(at, daily.endsAt));
        const changed = lead !== null && leadChanged(history.at(-1), lead) ? lead : null;
        const leads = changed === null ? history : [...history, changed];
        const shown = shownOf(view, leads);
        // The first read at or after the end is final: the card becomes the result whatever it
        // shows, its graph redrawn as the whole day.
        const final = at >= daily.endsAt;
        if (final || shown !== post.shown || Option.isSome(gif)) {
          const redraw = leads.length > 0 && (shown !== post.shown || final);
          const landed = yield* k.edit(
            Effect.gen(function* () {
              const graph = redraw
                ? yield* drawGraph(daily, leads, at).pipe(
                    Effect.mapError(
                      (e) =>
                        new DailyPostFailed({ reason: `draw the lead graph: ${String(e.cause)}` }),
                    ),
                  )
                : kept(leads.length > 0);
              yield* k.channel.edit(
                post.messageId,
                dailyCard(view, {
                  preview: kept(post.preview),
                  graph,
                  spin: Option.getOrElse(gif, () => kept(post.spin.state === "shown")),
                  closed: final,
                }),
              );
            }),
          );
          if (!landed) return false;
          if (Option.isSome(gif)) yield* k.setSpin({ state: "shown" });
        }
        if (changed !== null) {
          yield* k.log.addLead(date, changed);
          const line = leadLine(history, changed);
          if (line !== null && post.threadId !== null) {
            const said = yield* Effect.either(k.channel.say(post.threadId, dailyLineMessage(line)));
            if (Either.isLeft(said))
              yield* k.ops.tell(
                "line",
                `Multiballs couldn't post in the Daily Post's thread for ${date}: ${said.left.reason}`,
              );
            else yield* k.ops.clear("line");
          }
        }
        yield* k.save({
          ...(yield* Ref.get(k.current)),
          shown,
          readAt: at,
          state: final ? "closed" : "live",
          board: final ? read.right : null,
        });
        if (final) yield* Effect.logInfo(`daily post: ${date} closed`);
        return final;
      }),
  );
  yield* untilSpinShown(k);
});

/**
 * A closed card's spinning GIF (a backfilled card's, or one the close came before): asked for at
 * once, looked for every READ_EVERY, and edited into the card when it comes. It gives up once
 * ops has heard it is late, or when it still couldn't be asked for SPIN_WAIT after the close.
 */
const untilSpinShown = Effect.fn("untilSpinShown")(function* (k: Keeper) {
  const closed = yield* Ref.get(k.current);
  if (!spinPending(closed)) return;
  const { daily, map } = closed;
  yield* onSchedule(
    closed.readAt,
    (at) => at + READ_EVERY,
    (at) =>
      Effect.gen(function* () {
        yield* k.spin.ask;
        const gif = yield* k.spin.arrived;
        const post = yield* Ref.get(k.current);
        if (Option.isSome(gif)) {
          const leads = yield* k.log.leads(daily.date);
          const card = dailyCard(viewOf(daily, map, post.board, post.readAt), {
            preview: kept(post.preview),
            graph: kept(leads.length > 0),
            spin: gif.value,
            closed: true,
          });
          const landed = yield* k.edit(k.channel.edit(post.messageId, card));
          if (landed) yield* k.setSpin({ state: "shown" });
          return landed;
        }
        return !spinPending(post) || (post.spin.state === "ask" && at >= post.readAt + SPIN_WAIT);
      }),
  );
});

const awaitSpin = Effect.fn("awaitSpin")(function* (post: DailyPostRecord) {
  yield* untilSpinShown(yield* keeperOf(post));
});

/** A step where even a bug is only that step's: ops hears, and the schedule goes on. */
const safely = Effect.fn("safely")(function* <A, E, R>(what: string, step: Effect.Effect<A, E, R>) {
  return yield* step.pipe(
    Effect.catchAllDefect((defect) =>
      Effect.flatMap(OpsAlerts, (alerts) =>
        alerts.post(
          `Multiballs hit a bug ${what}: ${Cause.pretty(Cause.die(defect)).split("\n")[0] ?? ""}`,
        ),
      ),
    ),
  );
});

/** Keep a recorded Daily Post going: a live one current, a closed one's GIF still to come. */
const tend = Effect.fn("tend")(function* (post: DailyPostRecord) {
  yield* safely(
    `updating the Daily Post for ${post.daily.date}`,
    post.state === "live" ? keepCurrent(post) : awaitSpin(post),
  );
});

/** How many Dailies before the one open now the first run posts. */
export const BACKFILL_DAYS = 3;

/**
 * The backfill, on the first run with no Daily Posts recorded: the BACKFILL_DAYS Dailies before
 * `today`'s (the one open now), oldest first, posted closed from the leaderboard database (postPast) and recorded,
 * each with its lead. Without a database it says why and posts none; a database that can't be
 * read reaches ops and ends it; a date the database has no Daily for, or one still running, is
 * skipped. Returns the posts, whose GIFs are still to come.
 */
export const backfill = Effect.fn("backfill")(function* (today: string) {
  const history = yield* DailyHistory;
  const ops = yield* onceUntilCleared;
  if (!history.available) {
    yield* Effect.logInfo("daily post: no backfill (DATABASE_URL not set)");
    return [];
  }
  const posted: Array<DailyPostRecord> = [];
  for (let n = BACKFILL_DAYS; n >= 1; n--) {
    const date = addDays(today, -n);
    const found = yield* Effect.either(history.find(date));
    if (Either.isLeft(found)) {
      yield* ops.tell(
        "backfill",
        `Multiballs couldn't read the leaderboard database to backfill the Daily Posts before ${today}: ${found.left.reason}`,
      );
      return posted;
    }
    if (Option.isNone(found.right)) {
      yield* Effect.logInfo(`daily post: no Daily for ${date} in the database to backfill`);
      continue;
    }
    const past = found.right.value;
    if (past.daily.endsAt > (yield* Clock.currentTimeMillis)) {
      yield* Effect.logInfo(`daily post: the Daily for ${date} is still running; not backfilled`);
      continue;
    }
    const result = yield* Effect.either(postPast(past));
    if (Either.isLeft(result)) {
      yield* ops.tell(
        `backfill ${date}`,
        `Multiballs couldn't backfill the Daily Post for ${date}: ${result.left.reason}`,
      );
      continue;
    }
    const { post, threadFailed } = result.right;
    if (Option.isSome(threadFailed))
      yield* ops.tell(
        `thread ${date}`,
        `Multiballs backfilled the Daily Post for ${date}, but not all of its thread: ${threadFailed.value}`,
      );
    yield* Effect.logInfo(`daily post: backfilled ${date}`);
    posted.push(post);
  }
  return posted;
});

/**
 * Find today's Daily from 01:00 UTC, asking every minute until the API answers, and post it.
 * Ops hears once if the API fails, once if there is still no Daily an hour after 01:00, and once
 * if the post fails; each is tried again the next minute.
 */
const postToday = Effect.fn("postToday")(function* (date: string) {
  const api = yield* DailyApi;
  const ops = yield* onceUntilCleared;
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    if (dailyDateAt(now) !== date) return;
    const found = yield* Effect.either(api.find(date));
    if (Either.isLeft(found))
      yield* ops.tell(
        "api",
        `Multiballs can't ask the Daily API for ${date}: ${found.left.reason}`,
      );
    else if (Option.isNone(found.right)) {
      if (now >= openingOf(date) + HOUR)
        yield* ops.tell(
          "missing",
          `Multiballs has found no Daily for ${date} an hour after 01:00 UTC; it keeps asking every minute.`,
        );
    } else {
      const posted = yield* Effect.either(postDaily(found.right.value));
      if (Either.isRight(posted)) {
        const { post, threadFailed } = posted.right;
        if (Option.isSome(threadFailed))
          yield* ops.tell(
            "thread",
            `Multiballs posted the Daily Post for ${date}, but not its thread: ${threadFailed.value}`,
          );
        yield* Effect.logInfo(`daily post: posted ${date}`);
        return post;
      }
      yield* ops.tell(
        "post",
        `Multiballs couldn't post the Daily Post for ${date}: ${posted.left.reason}`,
      );
    }
    yield* Effect.sleep(ASK_EVERY);
  }
});

/** Resume every live Daily Post, then post each day's Daily as it opens. Needs a Scope. */
export const dailyPostLoop = Effect.gen(function* () {
  const log = yield* DailyPostLog;
  const posts = yield* log.all;
  for (const post of posts)
    if (post.state === "live" || spinPending(post)) yield* Effect.forkScoped(tend(post));
  if (posts.length === 0) {
    // Before 01:00 UTC the Daily still live is yesterday's: the backfill is the three before it.
    const today = dailyDateAt(yield* Clock.currentTimeMillis);
    const backfilled = yield* safely(
      `backfilling the Daily Posts before ${today}`,
      backfill(today),
    );
    for (const post of backfilled ?? []) yield* Effect.forkScoped(tend(post));
  }
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    // The Daily open now: before 01:00 UTC, yesterday's.
    const date = dailyDateAt(now);
    if (Option.isNone(yield* log.get(date))) {
      const post = yield* safely(`posting the Daily Post for ${date}`, postToday(date));
      if (post === undefined) yield* Effect.sleep(ASK_EVERY);
      else yield* Effect.forkScoped(tend(post));
      continue;
    }
    yield* Effect.sleep(openingOf(addDays(date, 1)) - now);
  }
});
