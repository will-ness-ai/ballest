import { defineConfig } from "drizzle-kit";

// Migrations are generated from db/schema.ts (`pnpm db:generate`) and applied by
// scripts/migrate.mjs, which the build runs, so every deploy's branch matches its code.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
