// Applies db/migrations to the database this deploy reads (docs/adr/0005), before
// `next build`. With no DATABASE_URL (a fork, a local build without a database) there is
// nothing to migrate and the build goes on. A preview whose DATABASE_URL is production's
// (the Neon integration gives previews no branch of their own yet) skips the migration too,
// so a branch's schema reaches production only when it merges.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Neon's pooled URL can't hold the session a migration's lock needs, so prefer the direct one.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, skipping");
} else if (process.env.VERCEL_ENV === "preview" && isProduction(url)) {
  console.warn(
    "migrate: this preview reads the production database (PRODUCTION_DB_ENDPOINT), skipping; " +
      "a page that needs this branch's migrations fails until it merges",
  );
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

/* the Neon endpoint ID (the host's first label, without -pooler) names one branch, as in
   db/seed/harness.ts; PRODUCTION_DB_ENDPOINT, set in Vercel, names production's */
function isProduction(url) {
  const production = process.env.PRODUCTION_DB_ENDPOINT?.trim().toLowerCase();
  if (!production) return false;
  const host = new URL(url).hostname.toLowerCase();
  return host.split(".")[0].replace(/-pooler$/, "") === production;
}
