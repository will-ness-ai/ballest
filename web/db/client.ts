import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

export type Db = ReturnType<typeof connect>;

// A typed client over one pool. The app makes one per server process (db/index.ts);
// tests make one per throwaway database.
export function connect(url: string) {
  return drizzle(new pg.Pool({ connectionString: url }), { schema });
}
