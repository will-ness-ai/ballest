// The rows the queries in db/site.ts return, as plain JSON (times as ISO strings or Unix
// seconds), since db/data.ts caches them. One definition each, which the queries, lib/ and
// the components all read, so nothing outside db/ imports the queries for a type.

export interface Freshness {
  /* when the latest Refresh finished */
  refreshedAt: string | null;
  /* the oldest of every Map's latest successful read: by then every Map had been read */
  mapsReadBy: string | null;
}

/* one row of a board, Steam's or derived, with its real rank */
export interface BoardRow {
  rank: number;
  steamId: string;
  persona: string;
  avatar: string | null;
  score: number;
  /* the score one place up, which the row's interval is to; null at rank 1 */
  ahead: number | null;
  /* All Seasons only: each season's part of the total */
  seasons: Record<string, number> | null;
}

export interface BoardPage {
  /* the rows the query matches, of which `rows` is the slice asked for */
  total: number;
  rows: Array<BoardRow>;
}

/* one of a Circuit Track's top three, which the podium tallies count */
export interface Placing {
  board: string;
  steamId: string;
  persona: string;
  avatar: string | null;
  profileUrl: string | null;
  rank: number;
  score: number;
}

/* a Workshop Map with its latest details and what its board says at a glance */
export interface WorkshopMap {
  pfid: string;
  /* the Map's board, Workshop_<pfid> */
  name: string;
  title: string;
  creator: string;
  /* the creator's Steam ID */
  cid: string | null;
  preview: string | null;
  /* published, Unix seconds */
  created: number;
  /* [bronze, silver, gold, author], seconds */
  medals: Array<number>;
  /* Steam's count of the Map's runs */
  entryCount: number;
  sessions: number;
  subs: number;
  /* the top three as [steam ID, persona, score]; empty for a Map nobody has a time on */
  top3: Array<[string, string, number]>;
  /* 1st to 3rd, in ticks; null under three runs */
  gap13: number | null;
  /* runs within a second of the record */
  crowd: number;
  /* runs at or under the author time */
  authorBeaten: number;
}

export interface PlayerProfile {
  steamId: string;
  persona: string;
  avatar: string | null;
  profileUrl: string | null;
}

/* a player's place on one board */
export interface PlayerFinish {
  board: string;
  rank: number;
  score: number;
  /* the board's rank-1 score and how many it ranks */
  lead: number;
  field: number;
}

/* A derived board's ranks, kept whole: every player page reads its row from here rather
   than working the board out again. `places` is [rank, score] by Steam ID. */
export interface DerivedStanding {
  lead: number;
  field: number;
  places: Record<string, [number, number] | undefined>;
}
export type DerivedStandings = Record<string, DerivedStanding>;

export interface PlayerData {
  profile: PlayerProfile;
  /* their place on every board they are on, Circuit (Steam's and derived) and Workshop */
  finishes: Array<PlayerFinish>;
}

/* The Players page's counts for everyone with a world record, podium or top 5 on the
   Circuit, or a time on a Map: [steam ID, persona, Circuit WRs, Workshop WRs, Circuit
   podiums, Workshop podiums, Circuit top 5s, Workshop top 5s, Maps], in Steam ID order
   (build_standings in tools/campaign_common.py). */
export type StandingsRow = [string, string, number, number, number, number, number, number, number];

export interface Standings {
  tracks: number;
  maps: number;
  players: Array<StandingsRow>;
}

/* a player the Compare dialog's search found */
export interface NameHit {
  steamId: string;
  persona: string;
  avatar: string | null;
}
