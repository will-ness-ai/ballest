// Applies db/migrations to the database this deploy reads (docs/adr/0005), before
// `next build`. On Vercel the Neon integration gives a preview its own branch, so a preview
// migrates its copy and production migrates production. With no DATABASE_URL (a fork, a
// local build without a database) there is nothing to migrate and the build goes on.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Neon's pooled URL can't hold the session a migration's lock needs, so prefer the direct one.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, skipping");
} else {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), {
      // fileURLToPath, not .pathname: on Windows that is "/C:/...", which no folder matches.
      migrationsFolder: fileURLToPath(new URL("../db/migrations", import.meta.url)),
    });
    console.log("migrate: up to date");
  } finally {
    await pool.end();
  }
}
