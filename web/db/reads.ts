// The queries behind the read layer (db/data.ts), each taking the database it reads so
// the tests can run them against a throwaway one. Results are plain JSON (times as ISO
// strings), because data.ts's cache stores them as JSON and a Date would come back a
// string anyway.
//
// Rank is not stored (docs/adr/0005): it is the order of a board's open Entries, fastest
// first on a time board and most points first on a points board, a tie going to the
// Entry first seen earlier and then to the lower Steam ID. Steam's own tie order may
// differ.
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "./client";
import { boards, entries, mapHistory, maps, players, refreshes } from "./schema";

export type BoardKind = (typeof boards.$inferSelect)["kind"];

// Every open Entry on the boards `where` picks, with its rank on its board.
function rankedOpen(db: Db, where?: SQL) {
  return db.$with("ranked").as(
    db
      .select({
        board: entries.board,
        steamId: entries.steamId,
        score: entries.score,
        ugcId: entries.ugcId,
        firstSeenRefresh: entries.firstSeenRefresh,
        rank: sql<number>`(row_number() over (
          partition by ${entries.board}
          order by case when ${boards.scoresPoints} then ${entries.score} end desc,
                   case when not ${boards.scoresPoints} then ${entries.score} end asc,
                   ${entries.firstSeenRefresh}, ${entries.steamId}))::int`.as("rank"),
      })
      .from(entries)
      .innerJoin(boards, eq(boards.name, entries.board))
      .where(and(isNull(entries.closedRefresh), where)),
  );
}

export interface BoardStandings {
  name: string;
  kind: BoardKind;
  season: string | null;
  display: string;
  scoresPoints: boolean;
  entries: Array<{
    rank: number;
    steamId: string;
    persona: string;
    avatar: string | null;
    profileUrl: string | null;
    score: number;
    ugcId: string | null;
  }>;
}

// A board and its open Entries in rank order, or null for a board that does not exist.
export async function boardStandings(db: Db, name: string): Promise<BoardStandings | null> {
  const board = (await db.select().from(boards).where(eq(boards.name, name))).at(0);
  if (!board) return null;
  const ranked = rankedOpen(db, eq(entries.board, name));
  const rows = await db
    .with(ranked)
    .select({
      rank: ranked.rank,
      steamId: ranked.steamId,
      persona: players.persona,
      avatar: players.avatar,
      profileUrl: players.profileUrl,
      score: ranked.score,
      ugcId: ranked.ugcId,
    })
    .from(ranked)
    .innerJoin(players, eq(players.steamId, ranked.steamId))
    .orderBy(asc(ranked.rank));
  return {
    name: board.name,
    kind: board.kind,
    season: board.season,
    display: board.display,
    scoresPoints: board.scoresPoints,
    entries: rows,
  };
}

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
// by Steam ID), or null for a board that does not exist.
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

export interface MapSummary {
  pfid: string;
  board: string;
  creatorSteamId: string | null;
  createdAt: string | null;
  title: string;
  creator: string | null;
  preview: string | null;
  // Bronze, Silver, Gold, Author, in seconds
  medals: Array<number> | null;
  sessions: number | null;
  subs: number | null;
  entryCount: number | null;
}

// Every Workshop Map with its latest map_history row, newest Map first.
export async function mapList(db: Db): Promise<Array<MapSummary>> {
  const latest = db
    .selectDistinctOn([mapHistory.pfid])
    .from(mapHistory)
    .orderBy(mapHistory.pfid, desc(mapHistory.lastSeenRefresh), desc(mapHistory.id))
    .as("latest");
  const rows = await db
    .select({
      pfid: maps.pfid,
      board: maps.board,
      creatorSteamId: maps.creatorSteamId,
      createdAt: maps.createdAt,
      title: latest.title,
      creator: latest.creator,
      preview: latest.preview,
      medals: latest.medals,
      sessions: latest.sessions,
      subs: latest.subs,
      entryCount: latest.entryCount,
    })
    .from(maps)
    .innerJoin(latest, eq(latest.pfid, maps.pfid))
    .orderBy(sql`${maps.createdAt} desc nulls last`, asc(maps.pfid));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString() ?? null }));
}

export interface PlayerEntries {
  steamId: string;
  persona: string;
  avatar: string | null;
  profileUrl: string | null;
  entries: Array<{
    board: string;
    kind: BoardKind;
    season: string | null;
    display: string;
    scoresPoints: boolean;
    rank: number;
    score: number;
    ugcId: string | null;
  }>;
}

// A player and their open Entry on every board they are on, by board name, or null for a
// Steam ID the database has never seen.
export async function playerEntries(db: Db, steamId: string): Promise<PlayerEntries | null> {
  const player = (await db.select().from(players).where(eq(players.steamId, steamId))).at(0);
  if (!player) return null;
  const theirs = db
    .select({ board: entries.board })
    .from(entries)
    .where(and(eq(entries.steamId, steamId), isNull(entries.closedRefresh)));
  const ranked = rankedOpen(db, inArray(entries.board, theirs));
  const rows = await db
    .with(ranked)
    .select({
      board: ranked.board,
      kind: boards.kind,
      season: boards.season,
      display: boards.display,
      scoresPoints: boards.scoresPoints,
      rank: ranked.rank,
      score: ranked.score,
      ugcId: ranked.ugcId,
    })
    .from(ranked)
    .innerJoin(boards, eq(boards.name, ranked.board))
    .where(eq(ranked.steamId, steamId))
    .orderBy(asc(ranked.board));
  return {
    steamId: player.steamId,
    persona: player.persona,
    avatar: player.avatar,
    profileUrl: player.profileUrl,
    entries: rows,
  };
}
