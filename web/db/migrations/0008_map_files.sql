CREATE TABLE "map_files" (
	"pfid" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"raw_size" integer NOT NULL,
	"gzipped" "bytea" NOT NULL,
	"read_at" timestamp with time zone NOT NULL
);
