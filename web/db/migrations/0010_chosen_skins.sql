CREATE TABLE "chosen_skin_saves" (
	"steam_id" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chosen_skins" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"skin" text NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chosen_skin_saves_player" ON "chosen_skin_saves" USING btree ("steam_id","saved_at");