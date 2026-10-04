CREATE TYPE "public"."board_kind" AS ENUM('track', 'overall', 'map');--> statement-breakpoint
CREATE TYPE "public"."refresh_source" AS ENUM('collector', 'backfill');--> statement-breakpoint
CREATE TABLE "board_reads" (
	"refresh_id" integer NOT NULL,
	"board" text NOT NULL,
	"ok" boolean NOT NULL,
	"entry_count" integer,
	CONSTRAINT "board_reads_refresh_id_board_pk" PRIMARY KEY("refresh_id","board")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"name" text PRIMARY KEY NOT NULL,
	"kind" "board_kind" NOT NULL,
	"season" text,
	"display" text NOT NULL,
	"leaderboard_id" bigint,
	"scores_points" boolean NOT NULL,
	CONSTRAINT "boards_leaderboard_id_unique" UNIQUE("leaderboard_id")
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board" text NOT NULL,
	"steam_id" text NOT NULL,
	"score" bigint NOT NULL,
	"ugc_id" text,
	"first_seen_refresh" integer NOT NULL,
	"last_seen_refresh" integer NOT NULL,
	"closed_refresh" integer
);
--> statement-breakpoint
CREATE TABLE "map_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"pfid" text NOT NULL,
	"title" text NOT NULL,
	"creator" text,
	"preview" text,
	"medals" double precision[],
	"sessions" integer,
	"subs" integer,
	"entry_count" integer,
	"first_seen_refresh" integer NOT NULL,
	"last_seen_refresh" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"pfid" text PRIMARY KEY NOT NULL,
	"board" text NOT NULL,
	"creator_steam_id" text,
	"created_at" timestamp with time zone,
	CONSTRAINT "maps_board_unique" UNIQUE("board")
);
--> statement-breakpoint
CREATE TABLE "persona_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"persona" text NOT NULL,
	"first_seen_refresh" integer NOT NULL,
	"last_seen_refresh" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"persona" text NOT NULL,
	"avatar" text,
	"profile_url" text
);
--> statement-breakpoint
CREATE TABLE "refreshes" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"source" "refresh_source" NOT NULL,
	"commit_sha" text
);
--> statement-breakpoint
ALTER TABLE "board_reads" ADD CONSTRAINT "board_reads_refresh_id_refreshes_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_reads" ADD CONSTRAINT "board_reads_board_boards_name_fk" FOREIGN KEY ("board") REFERENCES "public"."boards"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_board_boards_name_fk" FOREIGN KEY ("board") REFERENCES "public"."boards"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_steam_id_players_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."players"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_first_seen_refresh_refreshes_id_fk" FOREIGN KEY ("first_seen_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_last_seen_refresh_refreshes_id_fk" FOREIGN KEY ("last_seen_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_closed_refresh_refreshes_id_fk" FOREIGN KEY ("closed_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_history" ADD CONSTRAINT "map_history_first_seen_refresh_refreshes_id_fk" FOREIGN KEY ("first_seen_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_history" ADD CONSTRAINT "map_history_last_seen_refresh_refreshes_id_fk" FOREIGN KEY ("last_seen_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_history" ADD CONSTRAINT "map_history_pfid_maps_pfid_fk" FOREIGN KEY ("pfid") REFERENCES "public"."maps"("pfid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_board_boards_name_fk" FOREIGN KEY ("board") REFERENCES "public"."boards"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_history" ADD CONSTRAINT "persona_history_steam_id_players_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."players"("steam_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_history" ADD CONSTRAINT "persona_history_first_seen_refresh_refreshes_id_fk" FOREIGN KEY ("first_seen_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_history" ADD CONSTRAINT "persona_history_last_seen_refresh_refreshes_id_fk" FOREIGN KEY ("last_seen_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_open" ON "entries" USING btree ("board","steam_id") WHERE "entries"."closed_refresh" is null;--> statement-breakpoint
CREATE INDEX "map_history_map" ON "map_history" USING btree ("pfid");--> statement-breakpoint
CREATE INDEX "persona_history_player" ON "persona_history" USING btree ("steam_id");