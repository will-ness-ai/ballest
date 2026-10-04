// A board's Score history: every Entry it has held, open and closed (docs/adr/0005). The
// pages read current boards through db/site.ts; this is the history the later features
// (personal-best progression, world-record history) start from.
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "./client";
import { boards, entries, players, refreshes } from "./schema";

export interface HistoryEntry {
  steamId: string;
  persona: string;
  score: number;
  ugcId: string | null;
  // when the Refreshes that first saw it, last saw it and closed it started; for a
  // backfilled Entry, first seen means no later than
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
}

// Every Entry a board has held, open and closed, in the order they were first seen (then
// by Steam ID), or null for a board that does not exist. An Overall board (scores_points)
// keeps current points only, updated in place (docs/adr/0005): its Entries carry today's
// points with the date the player first appeared, so its history comes from the tracks'.
export async function scoreHistory(db: Db, board: string): Promise<Array<HistoryEntry> | null> {
  const found = await db.select({ name: boards.name }).from(boards).where(eq(boards.name, board));
  if (found.length === 0) return null;
  const first = alias(refreshes, "first");
  const last = alias(refreshes, "last");
  const closed = alias(refreshes, "closed");
  const rows = await db
    .select({
      steamId: entries.steamId,
      persona: players.persona,
      score: entries.score,
      ugcId: entries.ugcId,
      firstSeenAt: first.startedAt,
      lastSeenAt: last.startedAt,
      closedAt: closed.startedAt,
    })
    .from(entries)
    .innerJoin(players, eq(players.steamId, entries.steamId))
    .innerJoin(first, eq(first.id, entries.firstSeenRefresh))
    .innerJoin(last, eq(last.id, entries.lastSeenRefresh))
    .leftJoin(closed, eq(closed.id, entries.closedRefresh))
    .where(eq(entries.board, board))
    .orderBy(asc(entries.firstSeenRefresh), asc(entries.steamId), asc(entries.id));
  return rows.map((r) => ({
    ...r,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  }));
}
