ALTER TABLE "ghosts" ADD COLUMN "set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ghosts" ADD COLUMN "top_speed" real;--> statement-breakpoint
ALTER TABLE "ghosts" ADD COLUMN "profile" real[];