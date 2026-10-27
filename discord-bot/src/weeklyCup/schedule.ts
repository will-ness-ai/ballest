// The Weekly Cup (spec #353): in each server where it is switched on, a Cup every week that runs
// itself in #weekly-cup, every boundary in US Central (week.ts). One state machine per server,
// driven by the clock:
//
//   open      Monday 00:00: the Cup's post goes up with Sign up, Withdraw and Skip
//   voting    Thursday 12:00, with 2 Entrants or more (the Shortlist and its vote, #357)
//   racing    Friday 09:00 (the Cup Maps' reads and standings, #358)
//   final     Sunday 20:00: sign-up closes (the results, #358)
//   cancelled Thursday 12:00 with fewer than 2 Entrants: the post and a notice say so
//   skipped   a server admin skipped the week while it was open: its Entrants are told
//
// Sign-up stays open from Monday 00:00 to Sunday 20:00, so a late Entrant can still race. Each
// week is recorded in the bot's SQLite with its Entrants, and the schedule works only from that
// record and the clock, so a restart picks the week up where it was without posting again; a
// boundary passed while the bot was down is acted on as it starts. A week the bot first starts in
// after Thursday 12:00 gets no post: the next goes up on Monday.
//
// Its effects go through ports (the Cup's channel, the record, ops), so it is tested on the
// TestClock over fakes (test/weeklyCup.test.ts); the channel on discord.js is in live.ts.
import { SqlClient } from "@effect/sql";
import { Cause, Clock, Context, Data, Effect, Layer, Option, Ref, Schema } from "effect";
import { MigratorLive } from "../db.js";
import { OpsAlerts } from "../ops.js";
import { type CupWeek, weekAt } from "./week.js";

/** A Cup with fewer Entrants than this at Thursday 12:00 is cancelled. */
export const MIN_ENTRANTS = 2;

/** How soon a post that failed is tried again. */
const RETRY_EVERY = 60_000;

export const CUP_STATES = ["open", "voting", "racing", "final", "cancelled", "skipped"] as const;
export type CupState = (typeof CUP_STATES)[number];

/** Whether a member can still sign up for, or withdraw from, a Cup in this state. */
const signUpOpen = (state: CupState) =>
  state === "open" || state === "voting" || state === "racing";

/** What the Cup's post shows: its week, where it stands, and its Entrants in sign-up order. */
export interface CupPostView {
  readonly guildId: string;
  readonly week: CupWeek;
  readonly state: CupState;
  readonly entrants: ReadonlyArray<string>;
}

/** A message in the Cup's channel beside its post, pinging the week's Entrants. */
export type CupNotice =
  | {
      readonly _tag: "Cancelled";
      readonly week: string;
      readonly entrants: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Skipped";
      readonly week: string;
      readonly entrants: ReadonlyArray<string>;
    };

/** What a press is answered with, privately. */
export type CupAnswer =
  | { readonly _tag: "Text"; readonly text: string }
  /** Skip asks a server admin first: it can't be undone. */
  | { readonly _tag: "ConfirmSkip"; readonly week: string };

// ---------------------------------------------------------------- ports

/** Discord refused a post or an edit. */
export class CupPostFailed extends Data.TaggedError("CupPostFailed")<{
  readonly reason: string;
}> {}

/** One server's #weekly-cup. */
export class CupChannel extends Context.Tag("multiballs/CupChannel")<
  CupChannel,
  {
    /** Post a week's Cup; its message id. */
    readonly post: (view: CupPostView) => Effect.Effect<string, CupPostFailed>;
    readonly edit: (messageId: string, view: CupPostView) => Effect.Effect<void, CupPostFailed>;
    readonly say: (notice: CupNotice) => Effect.Effect<void, CupPostFailed>;
  }
>() {}

// ---------------------------------------------------------------- the record

const CupRow = Schema.Struct({
  state: Schema.Literal(...CUP_STATES),
  message_id: Schema.String,
});
const EntrantRow = Schema.Struct({ discord_id: Schema.String, signed_up_at: Schema.Number });

export interface CupRecord {
  readonly state: CupState;
  readonly messageId: string;
}
export interface Entrant {
  readonly discordId: string;
  readonly signedUpAt: number;
}

/** Each server's Cups, by week, and their Entrants: the bot's own SQLite. */
export class CupLog extends Context.Tag("multiballs/CupLog")<
  CupLog,
  {
    readonly get: (guildId: string, week: string) => Effect.Effect<Option.Option<CupRecord>>;
    readonly put: (guildId: string, week: string, cup: CupRecord) => Effect.Effect<void>;
    /** The week's Entrants, in sign-up order. */
    readonly entrants: (guildId: string, week: string) => Effect.Effect<ReadonlyArray<Entrant>>;
    /** False when they were signed up already. */
    readonly addEntrant: (
      guildId: string,
      week: string,
      entrant: Entrant,
    ) => Effect.Effect<boolean>;
    /** False when they weren't signed up. */
    readonly removeEntrant: (
      guildId: string,
      week: string,
      discordId: string,
    ) => Effect.Effect<boolean>;
  }
>() {}

export const CupLogLive = Layer.effect(
  CupLog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // The bot's own SQLite: a failure there is a defect, which the schedule reports to ops.
    return CupLog.of({
      get: Effect.fn("CupLog.get")(function* (guildId: string, week: string) {
        const rows =
          yield* sql`SELECT state, message_id FROM weekly_cups WHERE guild_id = ${guildId} AND week = ${week}`.pipe(
            Effect.flatMap(Schema.decodeUnknown(Schema.Array(CupRow))),
            Effect.orDie,
          );
        return Option.map(Option.fromNullable(rows[0]), (r) => ({
          state: r.state,
          messageId: r.message_id,
        }));
      }),
      put: Effect.fn("CupLog.put")(function* (guildId: string, week: string, cup: CupRecord) {
        yield* sql`INSERT OR REPLACE INTO weekly_cups (guild_id, week, state, message_id) VALUES (${guildId}, ${week}, ${cup.state}, ${cup.messageId})`.pipe(
          Effect.orDie,
        );
      }),
      entrants: Effect.fn("CupLog.entrants")(function* (guildId: string, week: string) {
        const rows =
          yield* sql`SELECT discord_id, signed_up_at FROM weekly_cup_entrants WHERE guild_id = ${guildId} AND week = ${week} ORDER BY signed_up_at, rowid`.pipe(
            Effect.flatMap(Schema.decodeUnknown(Schema.Array(EntrantRow))),
            Effect.orDie,
          );
        return rows.map((r) => ({ discordId: r.discord_id, signedUpAt: r.signed_up_at }));
      }),
      addEntrant: Effect.fn("CupLog.addEntrant")(function* (
        guildId: string,
        week: string,
        entrant: Entrant,
      ) {
        const added =
          yield* sql`INSERT OR IGNORE INTO weekly_cup_entrants (guild_id, week, discord_id, signed_up_at) VALUES (${guildId}, ${week}, ${entrant.discordId}, ${entrant.signedUpAt}) RETURNING discord_id`.pipe(
            Effect.orDie,
          );
        return added.length > 0;
      }),
      removeEntrant: Effect.fn("CupLog.removeEntrant")(function* (
        guildId: string,
        week: string,
        discordId: string,
      ) {
        const removed =
          yield* sql`DELETE FROM weekly_cup_entrants WHERE guild_id = ${guildId} AND week = ${week} AND discord_id = ${discordId} RETURNING discord_id`.pipe(
            Effect.orDie,
          );
        return removed.length > 0;
      }),
    });
  }),
).pipe(Layer.provide(MigratorLive));

// ---------------------------------------------------------------- the words of each answer

const said = (text: string): CupAnswer => ({ _tag: "Text", text });

const ADMINS_ONLY = said("Only a server admin (Manage Server) can skip a week.");

/** Why a member can't sign up for, or withdraw from, a Cup in this state. */
const closedBecause = (state: CupState | null): CupAnswer => {
  switch (state) {
    case "cancelled":
      return said(
        "This week's Weekly Cup was cancelled: fewer than 2 Players signed up. The next one opens on Monday.",
      );
    case "skipped":
      return said("This week's Weekly Cup was skipped. The next one opens on Monday.");
    default:
      return said("This week's Weekly Cup is over.");
  }
};

const unix = (ms: number) => Math.floor(ms / 1000);

// ---------------------------------------------------------------- one server's Cup

/**
 * One server's Weekly Cup: `run` keeps its schedule (it never ends), and the presses on its post
 * act on the week they were pressed for. One lock keeps a press and the schedule from acting on
 * the same week at once.
 */
export const makeWeeklyCup = Effect.fn("makeWeeklyCup")(function* (guildId: string) {
  const log = yield* CupLog;
  const lock = yield* Effect.makeSemaphore(1);
  const told = yield* Ref.make(new Set<string>());
  const locked = lock.withPermits(1);

  /** Ops hears about each kind of trouble once until it clears. */
  const tell = Effect.fn("cup.tell")(function* (kind: string, content: string) {
    const first = yield* Ref.modify(told, (s): [boolean, Set<string>] =>
      s.has(kind) ? [false, s] : [true, new Set(s).add(kind)],
    );
    if (first) yield* (yield* OpsAlerts).post(content);
  });
  const clear = (kind: string) =>
    Ref.update(told, (s) => {
      const next = new Set(s);
      next.delete(kind);
      return next;
    });

  const viewOf = Effect.fn("cup.viewOf")(function* (week: CupWeek, state: CupState) {
    const entrants = yield* log.entrants(guildId, week.week);
    return { guildId, week, state, entrants: entrants.map((e) => e.discordId) };
  });

  /** Redraw the post as the week stands; a refused edit reaches ops once until one lands. */
  const redraw = Effect.fn("cup.redraw")(function* (week: CupWeek, cup: CupRecord) {
    const channel = yield* CupChannel;
    const edited = yield* Effect.either(
      channel.edit(cup.messageId, yield* viewOf(week, cup.state)),
    );
    if (edited._tag === "Left")
      return yield* tell(
        "edit",
        `Multiballs couldn't update the Weekly Cup's post for ${week.week} in ${guildId}: ${edited.left.reason}`,
      );
    yield* clear("edit");
  });

  /** Move the week to `state`, redraw its post, and send its notice if it has one. */
  const enter = Effect.fn("cup.enter")(function* (
    week: CupWeek,
    cup: CupRecord,
    state: CupState,
    notice?: CupNotice["_tag"],
  ) {
    const next = { ...cup, state };
    yield* log.put(guildId, week.week, next);
    yield* redraw(week, next);
    if (notice !== undefined) {
      const entrants = (yield* log.entrants(guildId, week.week)).map((e) => e.discordId);
      const sent = yield* Effect.either(
        (yield* CupChannel).say({ _tag: notice, week: week.week, entrants }),
      );
      if (sent._tag === "Left")
        yield* (yield* OpsAlerts).post(
          `Multiballs couldn't tell the Weekly Cup's Entrants for ${week.week} in ${guildId} that it was ${state}: ${sent.left.reason}`,
        );
    }
    yield* Effect.logInfo(`weekly cup: ${guildId} ${week.week} is ${state}`);
  });

  /**
   * Act on the week as it stands at `now`, and say when to look again: post a week with no post
   * yet, and move a posted one on past each boundary it has reached.
   */
  const step = Effect.fn("cup.step")(function* (now: number) {
    const week = weekAt(now);
    const found = yield* log.get(guildId, week.week);
    if (Option.isNone(found)) {
      if (now >= week.shortlistAt) return week.nextOpensAt;
      const posted = yield* Effect.either(
        (yield* CupChannel).post({ guildId, week, state: "open", entrants: [] }),
      );
      if (posted._tag === "Left") {
        yield* tell(
          "post",
          `Multiballs couldn't post the Weekly Cup for ${week.week} in ${guildId}: ${posted.left.reason}`,
        );
        return now + RETRY_EVERY;
      }
      yield* clear("post");
      yield* log.put(guildId, week.week, { state: "open", messageId: posted.right });
      yield* Effect.logInfo(`weekly cup: posted ${week.week} in ${guildId}`);
      return week.shortlistAt;
    }
    const cup = found.value;
    switch (cup.state) {
      case "open": {
        if (now < week.shortlistAt) return week.shortlistAt;
        const entrants = yield* log.entrants(guildId, week.week);
        if (entrants.length < MIN_ENTRANTS) {
          yield* enter(week, cup, "cancelled", "Cancelled");
          return week.nextOpensAt;
        }
        yield* enter(week, cup, "voting");
        return week.voteClosesAt;
      }
      case "voting":
        if (now < week.voteClosesAt) return week.voteClosesAt;
        yield* enter(week, cup, "racing");
        return week.endsAt;
      case "racing":
        if (now < week.endsAt) return week.endsAt;
        yield* enter(week, cup, "final");
        return week.nextOpensAt;
      default:
        return week.nextOpensAt;
    }
  });

  /** A step where even a bug is only that step's: ops hears, and it is tried again shortly. */
  const safeStep = (now: number) =>
    locked(step(now)).pipe(
      Effect.catchAllDefect((defect) =>
        Effect.flatMap(OpsAlerts, (alerts) =>
          alerts.post(
            `Multiballs hit a bug running the Weekly Cup in ${guildId}: ${Cause.pretty(Cause.die(defect)).split("\n")[0] ?? ""}`,
          ),
        ).pipe(Effect.as(now + RETRY_EVERY)),
      ),
    );

  const run = Effect.gen(function* () {
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      const next = yield* safeStep(now);
      const wait = next - (yield* Clock.currentTimeMillis);
      if (wait > 0) yield* Effect.sleep(wait);
    }
  });

  /** The week a press was for, if it is still this week, with its Cup. */
  const pressedFor = Effect.fn("cup.pressedFor")(function* (pressed: string) {
    const week = weekAt(yield* Clock.currentTimeMillis);
    if (week.week !== pressed) return Option.none<{ week: CupWeek; cup: CupRecord }>();
    return Option.map(yield* log.get(guildId, pressed), (cup) => ({ week, cup }));
  });

  const signUp = (pressed: string, discordId: string) =>
    locked(
      Effect.gen(function* () {
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found) || !signUpOpen(found.value.cup.state))
          return closedBecause(Option.getOrNull(Option.map(found, (f) => f.cup.state)));
        const { week, cup } = found.value;
        const signedUpAt = yield* Clock.currentTimeMillis;
        if (!(yield* log.addEntrant(guildId, pressed, { discordId, signedUpAt })))
          return said("You're already signed up for this week's Cup.");
        yield* redraw(week, cup);
        return said(
          cup.state === "open"
            ? `You're signed up for this week's Weekly Cup. The Shortlist is drawn <t:${unix(week.shortlistAt)}:F>, and racing runs <t:${unix(week.voteClosesAt)}:F> to <t:${unix(week.endsAt)}:F>.`
            : `You're signed up for this week's Weekly Cup. It ends <t:${unix(week.endsAt)}:F>.`,
        );
      }),
    );

  const withdraw = (pressed: string, discordId: string) =>
    locked(
      Effect.gen(function* () {
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found) || !signUpOpen(found.value.cup.state))
          return closedBecause(Option.getOrNull(Option.map(found, (f) => f.cup.state)));
        const { week, cup } = found.value;
        if (!(yield* log.removeEntrant(guildId, pressed, discordId)))
          return said("You're not signed up for this week's Cup.");
        yield* redraw(week, cup);
        return said(
          "You've withdrawn from this week's Weekly Cup. Sign up again any time before it ends.",
        );
      }),
    );

  /** Whether the week can be skipped by this member now: none when it can, else why not. */
  const skipRefused = Effect.fn("cup.skipRefused")(function* (
    pressed: string,
    manageServer: boolean,
  ) {
    if (!manageServer) return Option.some(ADMINS_ONLY);
    const found = yield* pressedFor(pressed);
    if (Option.isNone(found)) return Option.some(closedBecause(null));
    const { state } = found.value.cup;
    if (state === "open") return Option.none<CupAnswer>();
    return Option.some(
      signUpOpen(state)
        ? said("This week's Weekly Cup is already under way, so it can't be skipped now.")
        : closedBecause(state),
    );
  });

  const askSkip = (pressed: string, _discordId: string, manageServer: boolean) =>
    locked(
      Effect.map(
        skipRefused(pressed, manageServer),
        Option.getOrElse((): CupAnswer => ({ _tag: "ConfirmSkip", week: pressed })),
      ),
    );

  const skip = (pressed: string, discordId: string, manageServer: boolean) =>
    locked(
      Effect.gen(function* () {
        const refused = yield* skipRefused(pressed, manageServer);
        if (Option.isSome(refused)) return refused.value;
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found)) return closedBecause(null);
        yield* enter(found.value.week, found.value.cup, "skipped", "Skipped");
        yield* Effect.logInfo(`weekly cup: ${discordId} skipped ${pressed} in ${guildId}`);
        return said("Skipped this week's Weekly Cup. Its Entrants have been told.");
      }),
    );

  return { guildId, run, signUp, withdraw, askSkip, skip };
});

export type WeeklyCup = Effect.Effect.Success<ReturnType<typeof makeWeeklyCup>>;
