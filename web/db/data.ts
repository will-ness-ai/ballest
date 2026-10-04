// The read layer the app calls: the queries in reads.ts over this server's database,
// each cached across requests and tagged DATA_TAG, so pages stay static between
// Refreshes and POST /api/revalidate (which the collector calls) refreshes them all.
//
// unstable_cache rather than "use cache": the latter needs cacheComponents in
// next.config.ts, which would change how the rest of the app renders. Cached values are
// stored as JSON, which is why reads.ts returns times as strings.
import { unstable_cache } from "next/cache";

import { connect, type Db } from "./client";
import { boardStandings, mapList, playerEntries, scoreHistory } from "./reads";

export type { BoardStandings, HistoryEntry, MapSummary, PlayerEntries } from "./reads";

export const DATA_TAG = "data";

let client: Db | undefined;

// One pool per server process, opened on the first read.
function db(): Db {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = connect(url);
  }
  return client;
}

// The Data Cache outlives a build (locally it sits in .next/cache), and nothing ties it
// to one Neon branch while each preview reads its own, so every key names the database
// it was read from (host and database name, never the password).
function databaseKey(url: string | undefined) {
  if (!url) return "none";
  const { host, pathname } = new URL(url);
  return host + pathname;
}
const database = databaseKey(process.env.DATABASE_URL);

const options = { tags: [DATA_TAG] };

export const getBoard = unstable_cache(
  (name: string) => boardStandings(db(), name),
  ["boardStandings", database],
  options,
);

export const getPlayer = unstable_cache(
  (steamId: string) => playerEntries(db(), steamId),
  ["playerEntries", database],
  options,
);

export const getMaps = unstable_cache(() => mapList(db()), ["mapList", database], options);

export const getScoreHistory = unstable_cache(
  (board: string) => scoreHistory(db(), board),
  ["scoreHistory", database],
  options,
);
