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
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PrefabAngle } from "../lib/prefabs";

export const refreshSource = pgEnum("refresh_source", ["collector", "backfill"]);

// One pass of the collector over Steam. A backfill Refresh is one snapshot of data/ from
// git, dated at its commit, so what it first saw was first seen no later than that.
export const refreshes = pgTable("refreshes", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  source: refreshSource("source").notNull(),
  commitSha: text("commit_sha"),
  // whether this Refresh's Workshop step read every Map's board, not only the ones played
  // since the last read: the collector sweeps once every FULL_SWEEP_SECONDS from the latest
  fullSweep: boolean("full_sweep").notNull().default(false),
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
// ID), so a row with a profile is final; an `ok` row from before profiles is read once more.
// Skin and hat are the object paths the Ghost names, as Steam reports them; the site maps a
// skin to its picture (lib/skins.ts). The profile is the run's time, in seconds, at each
// eightieth of its own path length, which the race drawer compares with the leader's. Top
// speed is in km/h. `empty` is a Ghost with no samples, `gone` one Steam has no file for:
// neither has any of these.
export const ghosts = pgTable("ghosts", {
  ugcId: text("ugc_id").primaryKey(),
  state: ghostState("state").notNull(),
  skin: text("skin"),
  hat: text("hat"),
  setAt: timestamp("set_at", { withTimezone: true }),
  topSpeed: real("top_speed"),
  profile: real("profile").array(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
});

// Postgres bytes, which Drizzle has no column type for: a Buffer either way.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// A Workshop Map's file (its .ballmap, the JSON the editor saves), downloaded from Steam by
// the collector's Map file step (tools/map_files.py, ADR 0010) and only read by the site.
// Only the current file is kept: `version` is Steam's content handle for it
// (`hcontent_file`), and a Map whose catalogue handle differs is downloaded again and its
// row replaced. `gzipped` is the file gzip-compressed, `raw_size` its length before. No
// foreign key to `maps`, as `dailies` has none: a Map can leave the Workshop.
export const mapFiles = pgTable("map_files", {
  pfid: text("pfid").primaryKey(),
  version: text("version").notNull(),
  rawSize: integer("raw_size").notNull(),
  gzipped: bytea("gzipped").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
});

// A Map's spinning 3D GIF for its Daily Post (spec #268): one full turn of the Map's 3D view on
// the site, drawn by daily-spin.yml (scripts/map-spin.ts) when Multiballs asks, and read by the
// bot. Only the latest drawing is kept; `version` is the map_files version it was drawn from,
// so a Map whose file changed since is drawn again. No foreign key, as map_files has none.
export const mapSpins = pgTable("map_spins", {
  pfid: text("pfid").primaryKey(),
  version: text("version").notNull(),
  gif: bytea("gif").notNull(),
  drawnAt: timestamp("drawn_at", { withTimezone: true }).notNull(),
});

// A Prefab (CONTEXT.md): a group of editor pieces a player uploaded, with the file exactly as
// they sent it (ADR 0009, the first table the site itself writes). The slug comes from the
// first name and never changes, so a link survives a rename. A deleted or taken-down Prefab
// keeps its row, which still counts against its uploader's hourly limit, and reads as gone. A
// banned uploader's Prefabs are hidden by the reads, not here, so an unban brings them back.
// The uploader is any signed-in Steam ID, not only a player the boards have seen, so there is
// no foreign key; uploader_name is their Steam persona when they uploaded, for a byline when
// the boards have no persona for them.
export const prefabs = pgTable(
  "prefabs",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // values from TAGS (lib/prefab-check.ts)
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    uploader: text("uploader").notNull(),
    uploaderName: text("uploader_name"),
    file: text("file").notNull(),
    pieces: integer("pieces").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    takenDownAt: timestamp("taken_down_at", { withTimezone: true }),
    // the view its uploader picked for its picture (PrefabAngle in lib/prefabs.ts), or null
    // for the default
    angle: jsonb("angle").$type<PrefabAngle>(),
  },
  (t) => [index("prefabs_uploader").on(t.uploader, t.createdAt)],
);

// A Favorite: one signed-in player's heart on one Prefab.
export const prefabFavorites = pgTable(
  "prefab_favorites",
  {
    prefabId: integer("prefab_id")
      .notNull()
      .references(() => prefabs.id),
    steamId: text("steam_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.prefabId, t.steamId] })],
);

// A player the admin has stopped uploading. Their Prefabs read as hidden while the row is here.
export const prefabBans = pgTable("prefab_bans", {
  steamId: text("steam_id").primaryKey(),
  bannedAt: timestamp("banned_at", { withTimezone: true }).notNull().defaultNow(),
  bannedBy: text("banned_by").notNull(),
});

// A player the admin has given their own hourly upload limit, in place of HOURLY_UPLOADS
// (lib/prefabs.ts). No row is the default.
export const prefabLimits = pgTable("prefab_limits", {
  steamId: text("steam_id").primaryKey(),
  perHour: integer("per_hour").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  setBy: text("set_by").notNull(),
});
