CREATE TABLE "map_spins" (
	"pfid" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"gif" "bytea" NOT NULL,
	"drawn_at" timestamp with time zone NOT NULL
);
