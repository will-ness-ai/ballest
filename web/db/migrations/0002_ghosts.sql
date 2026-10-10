CREATE TYPE "public"."ghost_state" AS ENUM('ok', 'empty', 'gone');--> statement-breakpoint
CREATE TABLE "ghosts" (
	"ugc_id" text PRIMARY KEY NOT NULL,
	"state" "ghost_state" NOT NULL,
	"skin" text,
	"hat" text,
	"read_at" timestamp with time zone NOT NULL
);
