// The database behind the site (docs/adr/0005): only what Steam reports, kept as
// change-only Score history. Ranks and the derived boards (Season 1 Current, All Seasons,
// podiums, standings) are not stored; they come from these rows. docs/data.md has the
// tables in prose.
//
// Steam IDs and UGC IDs are text: a UGC ID can exceed a signed bigint, and both arrive
// from Steam as digit strings. A score is the raw `score_ms` the collector reads, ticks
// for times (SCORE_TICKS_PER_SECOND) and points on Overall boards, never milliseconds.
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const refreshSource = pgEnum("refresh_source", ["collector", "backfill"]);

// One pass of the collector over Steam. A backfill Refresh is one snapshot of data/ from
// git, dated at its commit, so what it first saw was first seen no later than that.
export const refreshes = pgTable("refreshes", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  source: refreshSource("source").notNull(),
  commitSha: text("commit_sha"),
});

export const boardKind = pgEnum("board_kind", ["track", "overall", "map", "daily"]);

// Every board Steam holds: the Circuit's Tracks and Overall boards, each Map's, and each
// Daily's.
export const boards = pgTable("boards", {
  name: text("name").primaryKey(),
  kind: boardKind("kind").notNull(),
  // the Circuit board's group ("Season 1", ...); null for a Map or a Daily
  season: text("season"),
  display: text("display").notNull(),
  leaderboardId: bigint("leaderboard_id", { mode: "number" }).unique(),
  scoresPoints: boolean("scores_points").notNull(),
});

// Which boards a Refresh read and whether the read succeeded. Workshop Maps are read only
// when their activity moved, so an Entry's last_seen advances only through a row here.
export const boardReads = pgTable(
  "board_reads",
  {
    refreshId: integer("refresh_id")
      .notNull()
      .references(() => refreshes.id),
    board: text("board")
      .notNull()
      .references(() => boards.name),
    ok: boolean("ok").notNull(),
    entryCount: integer("entry_count"),
  },
  (t) => [primaryKey({ columns: [t.refreshId, t.board] })],
);

export const players = pgTable("players", {
  steamId: text("steam_id").primaryKey(),
  persona: text("persona").notNull(),
  avatar: text("avatar"),
  profileUrl: text("profile_url"),
});

// A row per persona a player has gone by, written only when it changes.
export const personaHistory = pgTable(
  "persona_history",
  {
    id: serial("id").primaryKey(),
    steamId: text("steam_id")
      .notNull()
      .references(() => players.steamId),
    persona: text("persona").notNull(),
    firstSeenRefresh: integer("first_seen_refresh")
      .notNull()
      .references(() => refreshes.id),
    lastSeenRefresh: integer("last_seen_refresh")
      .notNull()
      .references(() => refreshes.id),
  },
  (t) => [index("persona_history_player").on(t.steamId)],
);

// Score history: every Entry a player has held on a board. A row is written when a score
// first appears or changes; an unchanged score only moves last_seen_refresh. An Entry that
// leaves the board is closed by the Refresh that no longer saw it, never deleted.
export const entries = pgTable(
  "entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    board: text("board")
      .notNull()
      .references(() => boards.name),
    steamId: text("steam_id")
      .notNull()
      .references(() => players.steamId),
    score: bigint("score", { mode: "number" }).notNull(),
    ugcId: text("ugc_id"),
    firstSeenRefresh: integer("first_seen_refresh")
      .notNull()
      .references(() => refreshes.id),
    lastSeenRefresh: integer("last_seen_refresh")
      .notNull()
      .references(() => refreshes.id),
    closedRefresh: integer("closed_refresh").references(() => refreshes.id),
  },
  (t) => [
    uniqueIndex("entries_one_open")
      .on(t.board, t.steamId)
      .where(sql`${t.closedRefresh} is null`),
  ],
);

// A Workshop Map: what never changes. What can change is in map_history.
export const maps = pgTable("maps", {
  pfid: text("pfid").primaryKey(),
  board: text("board")
    .notNull()
    .unique()
    .references(() => boards.name),
  creatorSteamId: text("creator_steam_id"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

// A Map's metadata and activity, a row per change of any of them.
export const mapHistory = pgTable(
  "map_history",
  {
    id: serial("id").primaryKey(),
    pfid: text("pfid").notNull(),
    title: text("title").notNull(),
    creator: text("creator"),
    preview: text("preview"),
    // Bronze, Silver, Gold, Author, in seconds as the Map publishes them
    medals: doublePrecision("medals").array(),
    sessions: integer("sessions"),
    subs: integer("subs"),
    entryCount: integer("entry_count"),
    firstSeenRefresh: integer("first_seen_refresh")
      .notNull()
      .references(() => refreshes.id),
    lastSeenRefresh: integer("last_seen_refresh")
      .notNull()
      .references(() => refreshes.id),
  },
  (t) => [
    foreignKey({ columns: [t.pfid], foreignColumns: [maps.pfid] }),
    index("map_history_map").on(t.pfid),
  ],
);

// A Daily: the game's one-day challenge on one Workshop Map, with its own Steam board
// (named as the developers' API returns it, never built). Its window is the API's, which
// has not always been midnight to midnight UTC. Database-only: no file under data/.
export const dailies = pgTable("dailies", {
  date: date("date", { mode: "string" }).primaryKey(),
  board: text("board")
    .notNull()
    .unique()
    .references(() => boards.name),
  // no foreign key: a Map can leave the Workshop, or never have been read
  pfid: text("pfid").notNull(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  // the first Refresh that read the board ok at or after ends_at; once set, it is final
  // and the collector stops reading it
  finalRefresh: integer("final_refresh").references(() => refreshes.id),
});

export const ghostState = pgEnum("ghost_state", ["ok", "empty", "gone"]);

// A run's Ghost: the replay Steam stores with a score, by its UGC ID, read once by the
// collector's Ghost step (tools/ghosts.py). A Ghost never changes (a new PB gets a new UGC
// ID), so a row is final. Skin and hat are the object paths the Ghost names, as Steam
// reports them; the site maps a skin to its picture (lib/skins.ts). `empty` is a Ghost with
// no samples, `gone` one Steam has no file for: neither has a skin.
export const ghosts = pgTable("ghosts", {
  ugcId: text("ugc_id").primaryKey(),
  state: ghostState("state").notNull(),
  skin: text("skin"),
  hat: text("hat"),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
});
