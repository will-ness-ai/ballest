ALTER TYPE "public"."board_kind" ADD VALUE 'daily';--> statement-breakpoint
CREATE TABLE "dailies" (
	"date" date PRIMARY KEY NOT NULL,
	"board" text NOT NULL,
	"pfid" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"final_refresh" integer,
	CONSTRAINT "dailies_board_unique" UNIQUE("board")
);
--> statement-breakpoint
ALTER TABLE "dailies" ADD CONSTRAINT "dailies_board_boards_name_fk" FOREIGN KEY ("board") REFERENCES "public"."boards"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dailies" ADD CONSTRAINT "dailies_final_refresh_refreshes_id_fk" FOREIGN KEY ("final_refresh") REFERENCES "public"."refreshes"("id") ON DELETE no action ON UPDATE no action;