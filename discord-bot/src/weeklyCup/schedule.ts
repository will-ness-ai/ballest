// The Weekly Cup (spec #353): in each server where it is switched on, a Cup every week that runs
// itself in #weekly-cup, every boundary in US Central (week.ts). One state machine per server,
// driven by the clock:
//
//   open      Monday 00:00: the Cup's post goes up with Sign up, Withdraw and Skip
//   voting    Thursday 12:00, with 2 Entrants or more: the Shortlist is drawn and posted with its
//             vote (up to 3 picks each, Entrants only, changeable)
//   racing    Friday 09:00: the 3 most-voted are the Cup Maps, announced with a ping for
//             Entrants (the reads and standings, #358)
//   final     Sunday 20:00: sign-up closes (the results, #358)
//   cancelled Thursday 12:00 with fewer than 2 Entrants, or no Map to draw: the post and a
//             notice say so
//   skipped   a server admin skipped the week while it was open: its Entrants are told
//
// Sign-up stays open from Monday 00:00 to Sunday 20:00, so a late Entrant can still race. Each
// week is recorded in the bot's SQLite with its Entrants, its Shortlist, the votes and the Cup
// Maps, and the schedule works only from that record and the clock, so a restart picks the week
// up where it was without posting or drawing again; a boundary passed while the bot was down is
// acted on as it starts. A week the bot first starts in after Thursday 12:00 gets no post: the
// next goes up on Monday.
//
// Its effects go through ports (Steam, the Links, the Cup's channel, the record, ops, the Map
// previews), so it is tested on the TestClock over fakes (test/weeklyCup.test.ts); the channel on
// discord.js is in live.ts.
import { SqlClient } from "@effect/sql";
import { Cause, Clock, Context, Data, Effect, Layer, Option, Random, Ref, Schema } from "effect";
import { MigratorLive } from "../db.js";
import type { DrawnMap } from "../domain.js";
import { searchEligible } from "../eligibleMaps.js";
import { escape, mapName } from "../links.js";
import { OpsAlerts } from "../ops.js";
import { MapPreviews, type Preview } from "../previews.js";
import { type CupWeek, weekAt } from "./week.js";

/** A Cup with fewer Entrants than this at Thursday 12:00 is cancelled. */
export const MIN_ENTRANTS = 2;
/** How many Maps the Shortlist draws. */
export const SHORTLIST_SIZE = 10;
/** How many of them the vote makes Cup Maps, and how many each Entrant may pick. */
export const CUP_MAPS = 3;
/** The Cup's Eligible Map limit on author time, in seconds. */
export const CUP_AUTHOR_LIMIT = 3 * 60;
/** Most candidate Maps checked for the Shortlist: one Steam read each. */
const SHORTLIST_CHECKS = 100;
/** A board check that Steam drops is retried this many times. */
const READ_RETRIES = 2;

/** How soon a post or draw that failed is tried again. */
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

/** A Map drawn for a Shortlist, as the record keeps it. */
export const CupMap = Schema.Struct({
  pfid: Schema.String,
  title: Schema.String,
  creator: Schema.String,
  previewUrl: Schema.String,
  /** Its author Medal, in seconds. */
  authorSeconds: Schema.Number,
  boardId: Schema.Number,
  worldRecordTicks: Schema.Number,
});
export type CupMap = typeof CupMap.Type;

const cupMapOf = (m: DrawnMap): CupMap => ({
  pfid: m.pfid,
  title: m.title,
  creator: m.creator,
  previewUrl: m.previewUrl,
  authorSeconds: m.medals.author,
  boardId: m.boardId,
  worldRecordTicks: m.worldRecordTicks,
});

/** The Shortlist's post: each Map with its Workshop picture (none if Steam gave none). */
export interface ShortlistView {
  readonly guildId: string;
  readonly week: CupWeek;
  readonly maps: ReadonlyArray<{ readonly map: CupMap; readonly picture: Preview | null }>;
  /** How many the Shortlist draws when that many are eligible. */
  readonly wanted: number;
}

/** A message in the Cup's channel beside its post, pinging the week's Entrants. */
export type CupNotice =
  | {
      readonly _tag: "Cancelled";
      /** Fewer than 2 Entrants, or no Map none of them has Played. */
      readonly reason: "entrants" | "maps";
      readonly week: string;
      readonly entrants: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "Skipped";
      readonly week: string;
      readonly entrants: ReadonlyArray<string>;
    }
  | {
      readonly _tag: "CupMaps";
      readonly week: CupWeek;
      readonly entrants: ReadonlyArray<string>;
      /** In rank order, each with its votes. */
      readonly maps: ReadonlyArray<{ readonly map: CupMap; readonly votes: number }>;
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
    /** Post the Shortlist with its vote; its message id. */
    readonly postShortlist: (view: ShortlistView) => Effect.Effect<string, CupPostFailed>;
  }
>() {}

/** Which Steam account each Entrant linked: whose Played Maps keep a Map off the Shortlist. */
export class CupLinks extends Context.Tag("multiballs/CupLinks")<
  CupLinks,
  { readonly steamIdOf: (discordId: string) => Effect.Effect<Option.Option<string>> }
>() {}

// ---------------------------------------------------------------- the record

const CupRow = Schema.Struct({
  state: Schema.Literal(...CUP_STATES),
  message_id: Schema.String,
  shortlist_message_id: Schema.NullOr(Schema.String),
});
const EntrantRow = Schema.Struct({ discord_id: Schema.String, signed_up_at: Schema.Number });
const MapRow = Schema.Struct({
  data: Schema.parseJson(CupMap),
  cup_rank: Schema.NullOr(Schema.Number),
  votes: Schema.NullOr(Schema.Number),
});
const VoteRow = Schema.Struct({
  discord_id: Schema.String,
  picks: Schema.parseJson(Schema.Array(Schema.String)),
});

export interface CupRecord {
  readonly state: CupState;
  readonly messageId: string;
  /** The Shortlist's post, once it is up. */
  readonly shortlistMessageId: string | null;
}
export interface Entrant {
  readonly discordId: string;
  readonly signedUpAt: number;
}
/** A Shortlist Map, with its rank and votes once it is a Cup Map. */
export interface ShortlistedMap {
  readonly map: CupMap;
  readonly cupRank: number | null;
  readonly votes: number | null;
}
export interface Vote {
  readonly discordId: string;
  readonly picks: ReadonlyArray<string>;
}

/** Each server's Cups, by week, with their Entrants, Shortlists and votes: the bot's own SQLite. */
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
    /** The week's Shortlist in draw order; empty until it is drawn. */
    readonly shortlist: (
      guildId: string,
      week: string,
    ) => Effect.Effect<ReadonlyArray<ShortlistedMap>>;
    readonly putShortlist: (
      guildId: string,
      week: string,
      maps: ReadonlyArray<CupMap>,
    ) => Effect.Effect<void>;
    /** Make these Shortlist Maps the Cup Maps, in rank order, each with its votes. */
    readonly putCupMaps: (
      guildId: string,
      week: string,
      ranked: ReadonlyArray<{ readonly pfid: string; readonly votes: number }>,
    ) => Effect.Effect<void>;
    readonly votes: (guildId: string, week: string) => Effect.Effect<ReadonlyArray<Vote>>;
    /** An Entrant's vote, replacing the one before. */
    readonly putVote: (guildId: string, week: string, vote: Vote) => Effect.Effect<void>;
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
          yield* sql`SELECT state, message_id, shortlist_message_id FROM weekly_cups WHERE guild_id = ${guildId} AND week = ${week}`.pipe(
            Effect.flatMap(Schema.decodeUnknown(Schema.Array(CupRow))),
            Effect.orDie,
          );
        return Option.map(Option.fromNullable(rows[0]), (r) => ({
          state: r.state,
          messageId: r.message_id,
          shortlistMessageId: r.shortlist_message_id,
        }));
      }),
      put: Effect.fn("CupLog.put")(function* (guildId: string, week: string, cup: CupRecord) {
        yield* sql`INSERT OR REPLACE INTO weekly_cups (guild_id, week, state, message_id, shortlist_message_id) VALUES (${guildId}, ${week}, ${cup.state}, ${cup.messageId}, ${cup.shortlistMessageId})`.pipe(
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
      shortlist: Effect.fn("CupLog.shortlist")(function* (guildId: string, week: string) {
        const rows =
          yield* sql`SELECT data, cup_rank, votes FROM weekly_cup_maps WHERE guild_id = ${guildId} AND week = ${week} ORDER BY position`.pipe(
            Effect.flatMap(Schema.decodeUnknown(Schema.Array(MapRow))),
            Effect.orDie,
          );
        return rows.map((r) => ({ map: r.data, cupRank: r.cup_rank, votes: r.votes }));
      }),
      putShortlist: Effect.fn("CupLog.putShortlist")(function* (
        guildId: string,
        week: string,
        maps: ReadonlyArray<CupMap>,
      ) {
        const encode = Schema.encode(Schema.parseJson(CupMap));
        yield* Effect.forEach(maps, (map, position) =>
          Effect.flatMap(
            encode(map),
            (data) =>
              sql`INSERT INTO weekly_cup_maps (guild_id, week, position, pfid, board_id, data) VALUES (${guildId}, ${week}, ${position}, ${map.pfid}, ${map.boardId}, ${data})`,
          ),
        ).pipe(sql.withTransaction, Effect.orDie);
      }),
      putCupMaps: Effect.fn("CupLog.putCupMaps")(function* (
        guildId: string,
        week: string,
        ranked: ReadonlyArray<{ readonly pfid: string; readonly votes: number }>,
      ) {
        yield* Effect.forEach(
          ranked,
          ({ pfid, votes }, i) =>
            sql`UPDATE weekly_cup_maps SET cup_rank = ${i + 1}, votes = ${votes} WHERE guild_id = ${guildId} AND week = ${week} AND pfid = ${pfid}`,
        ).pipe(sql.withTransaction, Effect.orDie);
      }),
      votes: Effect.fn("CupLog.votes")(function* (guildId: string, week: string) {
        const rows =
          yield* sql`SELECT discord_id, picks FROM weekly_cup_votes WHERE guild_id = ${guildId} AND week = ${week} ORDER BY rowid`.pipe(
            Effect.flatMap(Schema.decodeUnknown(Schema.Array(VoteRow))),
            Effect.orDie,
          );
        return rows.map((r) => ({ discordId: r.discord_id, picks: r.picks }));
      }),
      putVote: Effect.fn("CupLog.putVote")(function* (guildId: string, week: string, vote: Vote) {
        yield* sql`INSERT OR REPLACE INTO weekly_cup_votes (guild_id, week, discord_id, picks) VALUES (${guildId}, ${week}, ${vote.discordId}, ${JSON.stringify(vote.picks)})`.pipe(
          Effect.orDie,
        );
      }),
    });
  }),
).pipe(Layer.provide(MigratorLive));

// ---------------------------------------------------------------- the words of each answer

const said = (text: string): CupAnswer => ({ _tag: "Text", text });

const ADMINS_ONLY = said("Only a server admin (Manage Server) can skip a week.");

/** Why a member can't sign up for, withdraw from or vote in a Cup in this state. */
const closedBecause = (state: CupState | null): CupAnswer => {
  switch (state) {
    case "cancelled":
      return said("This week's Weekly Cup was cancelled. The next one opens on Monday.");
    case "skipped":
      return said("This week's Weekly Cup was skipped. The next one opens on Monday.");
    default:
      return said("This week's Weekly Cup is over.");
  }
};

const unix = (ms: number) => Math.floor(ms / 1000);

/**
 * The Cup Maps from the Shortlist and the votes: the most-voted first, a tie settled at random
 * (the Shortlist shuffled, then sorted by votes, which keeps the shuffle's order among equals).
 * Only the votes of `entrants` count.
 */
const rank = Effect.fn("cup.rank")(function* (
  shortlist: ReadonlyArray<CupMap>,
  votes: ReadonlyArray<Vote>,
  entrants: ReadonlySet<string>,
) {
  const counts = new Map<string, number>();
  for (const v of votes)
    if (entrants.has(v.discordId))
      for (const pfid of v.picks) counts.set(pfid, (counts.get(pfid) ?? 0) + 1);
  const shuffled = [...(yield* Random.shuffle(shortlist))];
  return shuffled
    .map((map) => ({ map, votes: counts.get(map.pfid) ?? 0 }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, CUP_MAPS);
});

// ---------------------------------------------------------------- one server's Cup

/**
 * One server's Weekly Cup: `run` keeps its schedule (it never ends), and the presses on its posts
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

  const entrantIds = (week: string) =>
    Effect.map(log.entrants(guildId, week), (all) => all.map((e) => e.discordId));

  const viewOf = Effect.fn("cup.viewOf")(function* (week: CupWeek, state: CupState) {
    return { guildId, week, state, entrants: yield* entrantIds(week.week) };
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

  /** Move the week to `state` and redraw its post. */
  const enter = Effect.fn("cup.enter")(function* (week: CupWeek, cup: CupRecord, state: CupState) {
    const next = { ...cup, state };
    yield* log.put(guildId, week.week, next);
    yield* redraw(week, next);
    yield* Effect.logInfo(`weekly cup: ${guildId} ${week.week} is ${state}`);
  });

  /** Tell the week's Entrants it is off; a refused notice reaches ops. */
  const callOff = Effect.fn("cup.callOff")(function* (
    week: CupWeek,
    cup: CupRecord,
    notice:
      { readonly _tag: "Skipped" } | { readonly _tag: "Cancelled"; reason: "entrants" | "maps" },
  ) {
    const state = notice._tag === "Skipped" ? "skipped" : "cancelled";
    yield* enter(week, cup, state);
    const entrants = yield* entrantIds(week.week);
    const sent = yield* Effect.either(
      (yield* CupChannel).say({ ...notice, week: week.week, entrants }),
    );
    if (sent._tag === "Left")
      yield* (yield* OpsAlerts).post(
        `Multiballs couldn't tell the Weekly Cup's Entrants for ${week.week} in ${guildId} that it was ${state}: ${sent.left.reason}`,
      );
  });

  /** Draw the Shortlist from Maps none of these Entrants has Played, and record it. */
  const draw = Effect.fn("cup.draw")(function* (week: CupWeek, entrants: ReadonlyArray<Entrant>) {
    const links = yield* CupLinks;
    const steamIds = yield* Effect.forEach(entrants, (e) => links.steamIdOf(e.discordId));
    const { unplayed } = yield* searchEligible({
      authorLimitSeconds: CUP_AUTHOR_LIMIT,
      steamIds: steamIds.flatMap(Option.toArray),
      want: SHORTLIST_SIZE,
      maxChecks: SHORTLIST_CHECKS,
      retries: READ_RETRIES,
    });
    const maps = unplayed.map(cupMapOf);
    yield* log.putShortlist(guildId, week.week, maps);
    yield* Effect.logInfo(`weekly cup: drew ${maps.length} Maps for ${week.week} in ${guildId}`);
    return maps;
  });

  /**
   * Thursday 12:00: with enough Entrants signed up by then, draw the Shortlist (once: a restart
   * finds it recorded) and post it, and the week is voting. A draw Steam fails, or a post Discord
   * refuses, is tried again in a minute, ops told once. Returns when to look again.
   */
  const openVote = Effect.fn("cup.openVote")(function* (
    now: number,
    week: CupWeek,
    cup: CupRecord,
  ) {
    // Those signed up after Thursday 12:00 (while a draw is retried) were not checked against it.
    const checked = (yield* log.entrants(guildId, week.week)).filter(
      (e) => e.signedUpAt <= week.shortlistAt,
    );
    if (checked.length < MIN_ENTRANTS) {
      yield* callOff(week, cup, { _tag: "Cancelled", reason: "entrants" });
      return week.nextOpensAt;
    }
    let shortlist = (yield* log.shortlist(guildId, week.week)).map((s) => s.map);
    if (shortlist.length === 0) {
      const drawn = yield* Effect.either(draw(week, checked));
      if (drawn._tag === "Left") {
        yield* tell(
          "draw",
          `Multiballs couldn't draw the Weekly Cup's Shortlist for ${week.week} in ${guildId}: ${drawn.left.reason}`,
        );
        return now + RETRY_EVERY;
      }
      yield* clear("draw");
      shortlist = drawn.right;
      if (shortlist.length === 0) {
        yield* callOff(week, cup, { _tag: "Cancelled", reason: "maps" });
        return week.nextOpensAt;
      }
    }
    const previews = yield* MapPreviews;
    const maps = yield* Effect.forEach(shortlist, (map) =>
      Effect.map(previews.of(map.previewUrl), (p) => ({ map, picture: Option.getOrNull(p) })),
    );
    const posted = yield* Effect.either(
      (yield* CupChannel).postShortlist({ guildId, week, maps, wanted: SHORTLIST_SIZE }),
    );
    if (posted._tag === "Left") {
      yield* tell(
        "shortlist",
        `Multiballs couldn't post the Weekly Cup's Shortlist for ${week.week} in ${guildId}: ${posted.left.reason}`,
      );
      return now + RETRY_EVERY;
    }
    yield* clear("shortlist");
    yield* enter(week, { ...cup, shortlistMessageId: posted.right }, "voting");
    return week.voteClosesAt;
  });

  /**
   * Friday 09:00: the most-voted become the Cup Maps, recorded before they are announced, so a
   * restart or a refused announcement never redraws a tie; then the announcement, with a ping for
   * the Entrants, and the week is racing. A refused announcement is tried again in a minute.
   */
  const closeVote = Effect.fn("cup.closeVote")(function* (
    now: number,
    week: CupWeek,
    cup: CupRecord,
  ) {
    const entrants = yield* entrantIds(week.week);
    let shortlist = yield* log.shortlist(guildId, week.week);
    if (!shortlist.some((s) => s.cupRank !== null)) {
      const ranked = yield* rank(
        shortlist.map((s) => s.map),
        yield* log.votes(guildId, week.week),
        new Set(entrants),
      );
      yield* log.putCupMaps(
        guildId,
        week.week,
        ranked.map((r) => ({ pfid: r.map.pfid, votes: r.votes })),
      );
      shortlist = yield* log.shortlist(guildId, week.week);
    }
    const maps = shortlist
      .flatMap((s) => (s.cupRank === null ? [] : [{ ...s, cupRank: s.cupRank }]))
      .sort((a, b) => a.cupRank - b.cupRank)
      .map((s) => ({ map: s.map, votes: s.votes ?? 0 }));
    const sent = yield* Effect.either(
      (yield* CupChannel).say({ _tag: "CupMaps", week, entrants, maps }),
    );
    if (sent._tag === "Left") {
      yield* tell(
        "announce",
        `Multiballs couldn't announce the Weekly Cup's Cup Maps for ${week.week} in ${guildId}: ${sent.left.reason}`,
      );
      return now + RETRY_EVERY;
    }
    yield* clear("announce");
    yield* enter(week, cup, "racing");
    return week.endsAt;
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
      yield* log.put(guildId, week.week, {
        state: "open",
        messageId: posted.right,
        shortlistMessageId: null,
      });
      yield* Effect.logInfo(`weekly cup: posted ${week.week} in ${guildId}`);
      return week.shortlistAt;
    }
    const cup = found.value;
    switch (cup.state) {
      case "open":
        return now < week.shortlistAt ? week.shortlistAt : yield* openVote(now, week, cup);
      case "voting":
        return now < week.voteClosesAt ? week.voteClosesAt : yield* closeVote(now, week, cup);
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

  /** An Entrant's pick of up to 3 Shortlist Maps, replacing the one before, until Friday 09:00. */
  const vote = (pressed: string, discordId: string, picks: ReadonlyArray<string>) =>
    locked(
      Effect.gen(function* () {
        const found = yield* pressedFor(pressed);
        if (Option.isNone(found)) return closedBecause(null);
        const { week, cup } = found.value;
        const now = yield* Clock.currentTimeMillis;
        if (cup.state === "cancelled" || cup.state === "skipped") return closedBecause(cup.state);
        if (cup.state === "open")
          return now < week.shortlistAt
            ? said(`The Shortlist isn't drawn yet: it comes <t:${unix(week.shortlistAt)}:F>.`)
            : said("The Shortlist is still being drawn. Try again in a minute.");
        if (cup.state !== "voting" || now >= week.voteClosesAt) return said("The vote has closed.");
        if (!(yield* entrantIds(pressed)).includes(discordId))
          return said("Only Entrants can vote. Sign up on the Cup's post first.");
        if (picks.length === 0) return said("Pick at least one Map.");
        if (picks.length > CUP_MAPS) return said(`Pick up to ${CUP_MAPS} Maps.`);
        if (new Set(picks).size !== picks.length) return said("Pick each Map once.");
        const shortlist = (yield* log.shortlist(guildId, pressed)).map((s) => s.map);
        const picked = picks.map((pfid) => shortlist.find((m) => m.pfid === pfid));
        const named = picked.flatMap((m) => (m === undefined ? [] : [m]));
        if (named.length !== picks.length) return said("That Map isn't on this week's Shortlist.");
        yield* log.putVote(guildId, pressed, { discordId, picks });
        return said(
          `Your vote: ${named.map((m) => `**${escape(mapName(m))}**`).join(", ")}. You can change it until <t:${unix(week.voteClosesAt)}:F>.`,
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
    const now = yield* Clock.currentTimeMillis;
    if (state === "open" && now < found.value.week.shortlistAt) return Option.none<CupAnswer>();
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
        yield* callOff(found.value.week, found.value.cup, { _tag: "Skipped" });
        yield* Effect.logInfo(`weekly cup: ${discordId} skipped ${pressed} in ${guildId}`);
        return said("Skipped this week's Weekly Cup. Its Entrants have been told.");
      }),
    );

  return { guildId, run, signUp, withdraw, vote, askSkip, skip };
});

export type WeeklyCup = Effect.Effect.Success<ReturnType<typeof makeWeeklyCup>>;

/** What a Cup's presses run with. */
type CupPorts = CupChannel | OpsAlerts;

/** The presses on one server's Cup posts, each for the week its button names. */
export interface CupPresses {
  readonly signUp: (week: string, discordId: string) => Effect.Effect<CupAnswer>;
  readonly withdraw: (week: string, discordId: string) => Effect.Effect<CupAnswer>;
  /** An Entrant's picks, by pfid. */
  readonly vote: (
    week: string,
    discordId: string,
    picks: ReadonlyArray<string>,
  ) => Effect.Effect<CupAnswer>;
  /** `manageServer`: whether the member holds Manage Server there. */
  readonly askSkip: (
    week: string,
    discordId: string,
    manageServer: boolean,
  ) => Effect.Effect<CupAnswer>;
  readonly skip: (
    week: string,
    discordId: string,
    manageServer: boolean,
  ) => Effect.Effect<CupAnswer>;
}

/** A Cup's presses, with the channel and ops it runs with. */
export const pressesOf = Effect.fn("pressesOf")(function* (cup: WeeklyCup) {
  const context = yield* Effect.context<CupPorts>();
  const within = <A>(effect: Effect.Effect<A, never, CupPorts>) => Effect.provide(effect, context);
  return {
    signUp: (week, who) => within(cup.signUp(week, who)),
    withdraw: (week, who) => within(cup.withdraw(week, who)),
    vote: (week, who, picks) => within(cup.vote(week, who, picks)),
    askSkip: (week, who, manageServer) => within(cup.askSkip(week, who, manageServer)),
    skip: (week, who, manageServer) => within(cup.skip(week, who, manageServer)),
  } satisfies CupPresses;
});

/** Every server's Weekly Cup that is running, by server id (WEEKLY_CUP_GUILD_IDS, live.ts). */
export class WeeklyCups extends Context.Tag("multiballs/WeeklyCups")<
  WeeklyCups,
  { readonly in: (guildId: string) => Effect.Effect<Option.Option<CupPresses>> }
>() {}
