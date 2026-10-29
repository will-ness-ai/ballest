CREATE TABLE "map_activity" (
	"pfid" text PRIMARY KEY NOT NULL,
	"week_plays" integer NOT NULL,
	"votes_up" integer NOT NULL,
	"votes_down" integer NOT NULL,
	"vote_score" double precision NOT NULL,
	"refresh_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_activity" ADD CONSTRAINT "map_activity_refresh_id_refreshes_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;