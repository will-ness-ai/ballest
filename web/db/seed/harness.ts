// `pnpm db:seed <dataset>` (scripts/seed.ts): replaces everything in the database it
// targets with a named dataset from datasets/index.ts. It exists for Neon dev branches (and
// preview branches, once the integration makes them) and the tests, so it refuses anything
// that could be production (refusal).
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import type { Db } from "../client";
import * as schema from "../schema";
import { datasets, type DatasetName } from "./datasets";

export const NOT_PRODUCTION_FLAG = "--i-know-this-is-not-production";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// A Neon host's endpoint ID, which names one branch: the first label, without the
// `-pooler` that the pooled host adds (ep-xxx-pooler.c-14.… and ep-xxx.c-14.… are one).
function endpoint(host: string) {
  return host
    .toLowerCase()
    .split(".")[0]
    .replace(/-pooler$/, "");
}

// Why seeding `url` must not go ahead, or null when it may. Production is recognised by
// its branch: Neon gives every branch its own endpoint, and PRODUCTION_DB_ENDPOINT (set
// in Vercel) names production's. Without it, only a database on this machine is assumed
// safe.
export function refusal(
  url: string,
  env: Partial<Record<string, string>>,
  args: ReadonlyArray<string>,
): string | null {
  if (env.VERCEL_ENV === "production") return "refusing to seed: VERCEL_ENV is production";
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "refusing to seed: DATABASE_URL is not a URL";
  }
  const production = env.PRODUCTION_DB_ENDPOINT?.trim().toLowerCase();
  if (production) {
    if (endpoint(host) === production)
      return `refusing to seed: ${host} is the production database (PRODUCTION_DB_ENDPOINT)`;
    return null;
  }
  if (LOCAL_HOSTS.has(host) || args.includes(NOT_PRODUCTION_FLAG)) return null;
  return (
    `refusing to seed: ${host} is not local and PRODUCTION_DB_ENDPOINT is unset, so it could be ` +
    `production. Pass ${NOT_PRODUCTION_FLAG} if you are sure it is not.`
  );
}

export function isDataset(name: string): name is DatasetName {
  return Object.hasOwn(datasets, name);
}

const tables = Object.values<unknown>(schema).filter((t): t is PgTable => is(t, PgTable));

// Empties every table and writes the dataset, in one transaction, so a dataset that
// fails part way leaves the database as it was.
export async function seed(db: Db, name: DatasetName) {
  const list = sql.join(
    tables.map((t) => sql.identifier(getTableName(t))),
    sql`, `,
  );
  await db.transaction(async (tx) => {
    await tx.execute(sql`truncate table ${list} restart identity cascade`);
    await datasets[name].seed(tx);
  });
}
