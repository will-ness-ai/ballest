CREATE TABLE "prefab_bans" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"banned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"banned_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prefab_favorites" (
	"prefab_id" integer NOT NULL,
	"steam_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prefab_favorites_prefab_id_steam_id_pk" PRIMARY KEY("prefab_id","steam_id")
);
--> statement-breakpoint
CREATE TABLE "prefabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"uploader" text NOT NULL,
	"uploader_name" text,
	"file" text NOT NULL,
	"pieces" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"taken_down_at" timestamp with time zone,
	CONSTRAINT "prefabs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "prefab_favorites" ADD CONSTRAINT "prefab_favorites_prefab_id_prefabs_id_fk" FOREIGN KEY ("prefab_id") REFERENCES "public"."prefabs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prefabs_uploader" ON "prefabs" USING btree ("uploader","created_at");