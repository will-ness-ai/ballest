import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

export type Db = ReturnType<typeof connect>;

// A typed client over one pool. The app makes one per server process (db/data.ts);
// tests make one per throwaway database.
export function connect(url: string) {
  return drizzle(new pg.Pool({ connectionString: verifyFull(url) }), { schema });
}

// The Neon integration's URL asks for sslmode=require, which pg already treats as
// verify-full, and says so in a security warning every new server process logs at error
// level. Naming the mode it uses keeps that warning out of the logs.
const verifyFull = (url: string) => url.replace(/([?&]sslmode=)require(?=&|$)/, "$1verify-full");
