// A past Daily as the leaderboard database holds it (spec #268): what `pnpm daily-post` posts,
// closed, for a date already over. Plain SQL over the schema `web/` owns (ADR 0006), like the
// Daily Report's source. The final board is the Daily's open Entries; the lead is rebuilt from
// its Score history at each Refresh that read its board, so it is only as exact as the Refreshes
// (every three hours): each Lead's `at` is when that Refresh started.
import { SqlClient } from "@effect/sql";
import { Effect, Option, Schema } from "effect";
import { type BoardRead, type Daily, sameTime } from "./card.js";
import { type Lead, leadChanged } from "./lead.js";

/**
 * A change of lead rebuilt from the database: `exact` when its time is the run's own (from its
 * Ghost), otherwise the time of the Refresh that first saw it.
 */
export interface PastLead extends Lead {
  readonly exact: boolean;
}

/** A Daily that has run: its window and board, its final board, and its lead through the day. */
export interface PastDaily {
  readonly daily: Daily;
  readonly board: BoardRead;
  readonly leads: ReadonlyArray<PastLead>;
}

const Ms = Schema.Number;
const DailyRow = Schema.Struct({
  board: Schema.String,
  pfid: Schema.String,
  title: Schema.String,
  startsAt: Ms,
  endsAt: Ms,
  boardId: Schema.NullOr(Schema.Number),
});
const EntryRow = Schema.Struct({ name: Schema.String, ticks: Schema.Number });
const CountRow = Schema.Struct({ players: Schema.Number });
const HeldRow = Schema.Struct({
  steamId: Schema.String,
  name: Schema.String,
  ticks: Schema.Number,
  seenAt: Ms,
  closedAt: Schema.NullOr(Ms),
  setAt: Schema.NullOr(Ms),
});
const rows = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknown(Schema.Array(schema));

/**
 * The board's lead through the day, as the changes a live Daily's reads would record: each score
 * holds from when it was set (its Ghost's date, or else the Refresh that first saw it) until the
 * same player's next score was, or else until the Refresh that closed it.
 */
const leadsOf = (held: ReadonlyArray<typeof HeldRow.Type>): Array<PastLead> => {
  const runs = held.map((h) => ({ ...h, from: h.setAt ?? h.seenAt, exact: h.setAt !== null }));
  const spans = runs.map((run) => {
    const next = runs
      .filter((o) => o.steamId === run.steamId && o.seenAt > run.seenAt)
      .reduce<number | null>((at, o) => (at === null || o.from < at ? o.from : at), null);
    return { ...run, until: next ?? run.closedAt ?? Number.POSITIVE_INFINITY };
  });
  const moments = [
    ...new Set(spans.flatMap((s) => [s.from, ...(Number.isFinite(s.until) ? [s.until] : [])])),
  ].sort((a, b) => a - b);
  const leads: Array<PastLead> = [];
  for (const at of moments) {
    const now = spans
      .filter((s) => s.from <= at && at < s.until)
      .sort((a, b) => a.ticks - b.ticks || a.from - b.from || (a.steamId < b.steamId ? -1 : 1));
    const best = now[0];
    if (best === undefined) continue;
    const lead = {
      at,
      leaders: now.filter((s) => sameTime(s.ticks, best.ticks)).map((s) => s.name),
      ticks: best.ticks,
      exact: spans.some((s) => s.from === at && s.exact),
    };
    if (leadChanged(leads.at(-1), lead)) leads.push(lead);
  }
  return leads;
};

/** That date's Daily from the database, or None if it holds no Daily for it. Needs a SqlClient. */
export const pastDaily = Effect.fn("pastDaily")(function* (date: string) {
  const sql = yield* SqlClient.SqlClient;
  const ms = (column: string) => sql.unsafe(`(extract(epoch from ${column}) * 1000)::float8`);
  const found = yield* sql`
    select d.board, d.pfid, d.title, ${ms("d.starts_at")} as "startsAt",
           ${ms("d.ends_at")} as "endsAt", b.leaderboard_id::float8 as "boardId"
    from dailies d join boards b on b.name = d.board
    where d.date = ${date}`.pipe(Effect.flatMap(rows(DailyRow)));
  const row = found[0];
  if (row === undefined) return Option.none<PastDaily>();
  const board = row.board;
  // The site's ranking: fastest first, then first seen, then Steam ID.
  const top = yield* sql`
    select coalesce(p.persona, e.steam_id) as name, e.score::float8 as ticks
    from entries e
    join refreshes f on f.id = e.first_seen_refresh
    left join players p on p.steam_id = e.steam_id
    where e.board = ${board} and e.closed_refresh is null
    order by e.score, f.started_at, e.steam_id
    limit 3`.pipe(Effect.flatMap(rows(EntryRow)));
  const count = yield* sql`
    select count(*)::float8 as players from entries
    where board = ${board} and closed_refresh is null`.pipe(Effect.flatMap(rows(CountRow)));
  // Every score the board has held, closed ones included: when the Refresh that first saw it
  // started, when the one that closed it did, and when its Ghost says it was set, if that falls
  // between the last ok read before (or the Daily's start) and that Refresh's end. A Ghost's date
  // outside it (a year-1 date when unset, or a wrong clock) is not used.
  const held = yield* sql`
    select e.steam_id as "steamId", coalesce(p.persona, e.steam_id) as name,
           e.score::float8 as ticks, ${ms("f.started_at")} as "seenAt",
           ${ms("c.started_at")} as "closedAt",
           case when g.set_at >= greatest(d.starts_at, prev.at)
                 and g.set_at <= coalesce(f.finished_at, f.started_at)
                then ${ms("g.set_at")} end as "setAt"
    from entries e
    join dailies d on d.board = e.board
    join refreshes f on f.id = e.first_seen_refresh
    left join refreshes c on c.id = e.closed_refresh
    left join players p on p.steam_id = e.steam_id
    left join ghosts g on g.ugc_id = e.ugc_id
    left join lateral (
      select max(r.started_at) as at from board_reads br join refreshes r on r.id = br.refresh_id
      where br.board = e.board and br.ok and r.started_at < f.started_at
    ) prev on true
    where e.board = ${board}`.pipe(Effect.flatMap(rows(HeldRow)));
  return Option.some<PastDaily>({
    daily: {
      date,
      pfid: row.pfid,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      boardId: row.boardId ?? 0,
    },
    board: { players: count[0]?.players ?? 0, top },
    leads: leadsOf(held),
  });
});
