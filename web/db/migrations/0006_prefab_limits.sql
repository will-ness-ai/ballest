CREATE TABLE "prefab_limits" (
	"steam_id" text PRIMARY KEY NOT NULL,
	"per_hour" integer NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"set_by" text NOT NULL
);
