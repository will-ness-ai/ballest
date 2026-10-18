// The Daily Post (spec #268): from 01:00 UTC Multiballs asks the developers' Daily API for
// today's Daily every minute until it answers, posts its card in DAILY_CHANNEL_ID with a thread,
// then reads the Daily's Steam board every 15 minutes and edits the card when what it shows
// changed. The first read at or after the Daily's end is its last. Each Daily Post is recorded in
// the bot's SQLite, so a restart resumes the live one and never posts a date twice.
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
import {
  type BoardRead,
  type Challenge,
  type DailyMap,
  shownKey,
  threadName,
  viewOf,
} from "./card.js";
import { dailyCardMessage, type DailyMessage, PREVIEW_FILE, SPIN_FILE } from "./messages.js";
import { DailySpins, SPIN_WAIT, type SpinUnavailable } from "./spin.js";

/** How often a live Daily's board is read. */
export const READ_EVERY = Duration.toMillis("15 minutes");
/** How often the API is asked for today's Daily until it answers. */
export const ASK_EVERY = Duration.toMillis("1 minute");
/** When the bot starts asking for a day's Daily (the window opens at 01:00 UTC since 2026-09-05). */
export const OPENING_HOUR_UTC = 1;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The UTC day a moment falls on, "2026-10-18". */
export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const openingOf = (date: string) => Date.parse(`${date}T00:00:00Z`) + OPENING_HOUR_UTC * HOUR;

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
    readonly find: (date: string) => Effect.Effect<Option.Option<Challenge>, DailyApiUnavailable>;
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

export interface DailyFile {
  readonly name: string;
  readonly data: Uint8Array;
}

/** The daily challenge channel. */
export class DailyChannel extends Context.Tag("multiballs/DailyChannel")<
  DailyChannel,
  {
    /** Post a card with these files attached and open a thread on it. */
    readonly post: (
      message: DailyMessage,
      files: ReadonlyArray<DailyFile>,
      threadName: string,
    ) => Effect.Effect<
      { readonly messageId: string; readonly threadId: string },
      DailyPostFailed | DailyThreadFailed
    >;
    /** Redraw a card; its attachments stay, and `files` are attached beside them. */
    readonly edit: (
      messageId: string,
      message: DailyMessage,
      files?: ReadonlyArray<DailyFile>,
    ) => Effect.Effect<void, DailyPostFailed>;
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
  challenge: Schema.Struct({
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
});
export type DailyPostRecord = typeof DailyPostRecord.Type;

const Row = Schema.Struct({ data: Schema.parseJson(DailyPostRecord) });

export class DailyPostLog extends Context.Tag("multiballs/DailyPostLog")<
  DailyPostLog,
  {
    readonly get: (date: string) => Effect.Effect<Option.Option<DailyPostRecord>>;
    /** Every Daily Post still live, oldest first. */
    readonly live: Effect.Effect<ReadonlyArray<DailyPostRecord>>;
    readonly put: (post: DailyPostRecord) => Effect.Effect<void>;
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
      live: sql`SELECT data FROM daily_posts WHERE state = 'live' ORDER BY date`.pipe(
        Effect.flatMap(decode),
        Effect.map((rows) => rows.map((r) => r.data)),
        Effect.orDie,
      ),
      put: Effect.fn("DailyPostLog.put")(function* (post: DailyPostRecord) {
        const data = yield* Schema.encode(Schema.parseJson(DailyPostRecord))(post).pipe(
          Effect.orDie,
        );
        yield* sql`INSERT OR REPLACE INTO daily_posts (date, state, data) VALUES (${post.challenge.date}, ${post.state}, ${data})`.pipe(
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
    tell: (kind: string, content: string) =>
      Ref.modify(told, (s): [boolean, Set<string>] =>
        s.has(kind) ? [false, s] : [true, new Set(s).add(kind)],
      ).pipe(Effect.flatMap((first) => (first ? alerts.post(content) : Effect.void))),
    clear: (kind: string) =>
      Ref.update(told, (s) => {
        const next = new Set(s);
        next.delete(kind);
        return next;
      }),
  };
});

/**
 * Post a Daily's card: its Map, a first read of its board (none if that fails: the next read
 * retries), the Workshop screenshot when Steam gives it, and a thread. Returns the record, and
 * why the thread failed if it did.
 */
export const postDaily = Effect.fn("postDaily")(function* (challenge: Challenge) {
  const steam = yield* DailySteam;
  const channel = yield* DailyChannel;
  const previews = yield* MapPreviews;
  const map = yield* steam.map(challenge.pfid);
  const board = yield* steam.board(challenge.boardId).pipe(Effect.option);
  const readAt = yield* Clock.currentTimeMillis;
  const view = viewOf(challenge, map, Option.getOrNull(board), readAt);
  const preview = yield* previews.of(map.previewUrl);
  const files = Option.match(preview, {
    onNone: () => [],
    onSome: (p) => [{ name: PREVIEW_FILE, data: p.body }],
  });
  const record = (messageId: string, threadId: string | null): DailyPostRecord => ({
    challenge,
    map,
    preview: Option.isSome(preview),
    messageId,
    threadId,
    state: "live",
    shown: shownKey(view),
    readAt,
    spin: SPIN_TO_ASK,
  });
  // A card whose thread failed is still that day's post: recorded, so it isn't posted again.
  return yield* channel
    .post(dailyCardMessage(view, { preview: Option.isSome(preview) }), files, threadName(view))
    .pipe(
      Effect.map(({ messageId, threadId }) => ({
        post: record(messageId, threadId),
        threadFailed: Option.none<string>(),
      })),
      Effect.catchTag("DailyThreadFailed", (e) =>
        Effect.succeed({ post: record(e.messageId, null), threadFailed: Option.some(e.reason) }),
      ),
    );
});

/**
 * Keep a live Daily Post's card current: a read every READ_EVERY from its last one, and one at
 * the Daily's end, which is its last. A failed read keeps the card as it was and is retried at
 * the next. Its spinning GIF is asked for at once (spin.ts), and edited in at the first read
 * after it is drawn.
 */
const keepCurrent = Effect.fn("keepCurrent")(function* (start: DailyPostRecord) {
  const steam = yield* DailySteam;
  const channel = yield* DailyChannel;
  const log = yield* DailyPostLog;
  const spins = yield* DailySpins;
  const ops = yield* onceUntilCleared;
  const { challenge, map } = start;
  const date = challenge.date;
  const pfid = challenge.pfid;
  let post = start;
  let nextAt = Math.min(post.readAt + READ_EVERY, challenge.endsAt);

  /** A database that can't be read leaves the GIF as it was, to try again at the next read. */
  const unread = (e: SpinUnavailable) =>
    Effect.logWarning(`daily post: can't read the spinning GIF for ${date}: ${e.reason}`);
  /**
   * Ask for the GIF if it is still to ask for: none for a Map with no file, and no drawing when
   * one from the same file is already there. A refused ask reaches ops once and is tried again
   * at the next read.
   */
  const ask = Effect.gen(function* () {
    if (post.spin.state !== "ask") return;
    const file = yield* Effect.either(spins.fileVersion(pfid));
    if (Either.isLeft(file)) return yield* unread(file.left);
    if (Option.isNone(file.right)) {
      post = { ...post, spin: { state: "none", version: null, askedAt: 0 } };
      return yield* log.put(post);
    }
    const version = file.right.value;
    const latest = yield* Effect.either(spins.latest(pfid));
    if (Either.isLeft(latest)) return yield* unread(latest.left);
    const drawn = Option.exists(latest.right, (s) => s.version === version);
    if (!drawn) {
      const asked = yield* Effect.either(spins.draw(pfid));
      if (Either.isLeft(asked))
        return yield* ops.tell(
          "spin",
          `Multiballs couldn't start drawing the spinning GIF for the Daily for ${date}: ${asked.left.reason}`,
        );
      yield* ops.clear("spin");
      yield* Effect.logInfo(`daily post: asked for the spinning GIF of ${pfid}`);
    }
    post = {
      ...post,
      spin: { state: "asked", version, askedAt: yield* Clock.currentTimeMillis },
    };
    yield* log.put(post);
  });
  /** The GIF, once it is drawn from the file asked about or since; ops hears once if it's late. */
  const arrived = Effect.gen(function* () {
    const { state, version, askedAt } = post.spin;
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
        post = { ...post, spin: { ...post.spin, state: "late" } };
        yield* log.put(post);
      }
    }
    return gif;
  });

  yield* ask;
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    if (nextAt > now) yield* Effect.sleep(nextAt - now);
    const at = yield* Clock.currentTimeMillis;
    nextAt = at >= challenge.endsAt ? at + READ_EVERY : Math.min(at + READ_EVERY, challenge.endsAt);
    const read = yield* Effect.either(steam.board(challenge.boardId));
    if (Either.isLeft(read)) {
      yield* ops.tell(
        "read",
        `Multiballs couldn't read the board of the Daily for ${date}: ${read.left.reason}`,
      );
      continue;
    }
    yield* ops.clear("read");
    yield* ask;
    const gif = yield* arrived;
    const view = viewOf(challenge, map, read.right, at);
    const shown = shownKey(view);
    if (shown !== post.shown || Option.isSome(gif)) {
      const spin = post.spin.state === "shown" || Option.isSome(gif);
      const files = Option.match(gif, {
        onNone: () => [],
        onSome: (data) => [{ name: SPIN_FILE, data }],
      });
      const edited = yield* Effect.either(
        channel.edit(
          post.messageId,
          dailyCardMessage(view, { preview: post.preview, spin }),
          files,
        ),
      );
      if (Either.isLeft(edited)) {
        yield* ops.tell(
          "edit",
          `Multiballs couldn't update the Daily Post for ${date}: ${edited.left.reason}`,
        );
        continue;
      }
      yield* ops.clear("edit");
      if (Option.isSome(gif)) post = { ...post, spin: { ...post.spin, state: "shown" } };
    }
    const final = at >= challenge.endsAt;
    post = { ...post, shown, readAt: at, state: final ? "closed" : "live" };
    yield* log.put(post);
    if (final) {
      yield* Effect.logInfo(`daily post: ${date} closed`);
      return;
    }
  }
});

/** A step where even a bug is only that step's: ops hears, and the schedule goes on. */
const safely = <A, E, R>(what: string, step: Effect.Effect<A, E, R>) =>
  step.pipe(
    Effect.catchAllDefect((defect) =>
      Effect.flatMap(OpsAlerts, (alerts) =>
        alerts.post(
          `Multiballs hit a bug ${what}: ${Cause.pretty(Cause.die(defect)).split("\n")[0] ?? ""}`,
        ),
      ),
    ),
  );

const keepCurrentSafely = (post: DailyPostRecord) =>
  safely(`updating the Daily Post for ${post.challenge.date}`, keepCurrent(post));

/**
 * Find today's Daily from 01:00 UTC, asking every minute until the API answers, and post it.
 * Ops hears once if the API fails, once if there is still no Daily an hour after 01:00, and once
 * if the post fails; each is tried again the next minute.
 */
const postToday = Effect.fn("postToday")(function* (date: string) {
  const api = yield* DailyApi;
  const log = yield* DailyPostLog;
  const ops = yield* onceUntilCleared;
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    if (dayOf(now) !== date) return;
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
        yield* log.put(post);
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
  for (const post of yield* log.live) yield* Effect.forkScoped(keepCurrentSafely(post));
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    const date = dayOf(now);
    const opening = openingOf(date);
    if (now < opening) {
      yield* Effect.sleep(opening - now);
      continue;
    }
    if (Option.isNone(yield* log.get(date))) {
      const post = yield* safely(`posting the Daily Post for ${date}`, postToday(date));
      if (post === undefined) yield* Effect.sleep(ASK_EVERY);
      else yield* Effect.forkScoped(keepCurrentSafely(post));
      continue;
    }
    yield* Effect.sleep(opening + DAY - now);
  }
});
