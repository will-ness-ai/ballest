CREATE TABLE "game_sign_ins" (
	"address" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prefab_writes" (
	"steam_id" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "game_sign_ins_address" ON "game_sign_ins" USING btree ("address","signed_at");--> statement-breakpoint
CREATE INDEX "game_sign_ins_at" ON "game_sign_ins" USING btree ("signed_at");--> statement-breakpoint
CREATE INDEX "prefab_writes_player" ON "prefab_writes" USING btree ("steam_id","written_at");--> statement-breakpoint
CREATE INDEX "prefab_writes_at" ON "prefab_writes" USING btree ("written_at");