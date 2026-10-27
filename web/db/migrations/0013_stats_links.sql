CREATE TABLE "stats_link_requests" (
	"token" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"discord_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stats_links" (
	"discord_id" text PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
