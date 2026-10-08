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

/* one Daily: the game's one-day challenge on a Workshop Map, with its own board */
export interface DailyDay {
  /* YYYY-MM-DD, the API's name for it */
  date: string;
  /* its own board, as the API names it */
  board: string;
  pfid: string;
  title: string;
  /* the Map's picture and Medals ([bronze, silver, gold, author], seconds), from its
     latest catalogue row; null and empty for a Map no catalogue has listed */
  preview: string | null;
  medals: Array<number>;
  /* whether the Workshop lists the Map now, so its own page and all-time board exist */
  listed: boolean;
  startsAt: string;
  endsAt: string;
  /* a read after its close made it final; live or not is the reader's clock against endsAt */
  final: boolean;
  /* the times on its board */
  entryCount: number;
}

/* a player's place on one Daily, of the field its board ranks */
export interface PlayerDaily {
  date: string;
  rank: number;
  field: number;
  /* a read after its close made it final; until then its place can still change */
  final: boolean;
}

/* a player's Daily record: every Daily they have a time on, oldest first, their wins and
   podiums on final Dailies, and their runs of Dailies played one after another (runsOf in
   lib/daily.ts) */
export interface PlayerDailies {
  played: Array<PlayerDaily>;
  won: number;
  podiums: number;
  longest: number;
  current: number;
}

/* one day of the Daily page's calendar: a Daily as its cell and its day strip draw it */
export interface DailyCell {
  date: string;
  pfid: string;
  title: string;
  preview: string | null;
  startsAt: string;
  endsAt: string;
  final: boolean;
  entryCount: number;
  /* its 1st, leading or the day's winner; null while nobody has set a time */
  winner: { steamId: string; persona: string } | null;
}

/* one player's place on one final Daily, which the Daily standings count */
export interface DailyFinish {
  date: string;
  steamId: string;
  persona: string;
  avatar: string | null;
  rank: number;
}

/* one player's all-time Daily record, over final Dailies only */
export interface DailyStanding {
  steamId: string;
  persona: string;
  avatar: string | null;
  gold: number;
  silver: number;
  bronze: number;
  podiums: number;
  top10: number;
  played: number;
  /* the longest run of consecutive Dailies played, and of consecutive Dailies won */
  playedRun: number;
  winRun: number;
}

export type DailyRecordKey = "wins" | "podiums" | "played" | "playedRun" | "winRun";

/* a record card: its top three, equal values sharing a place (1, 2, 2), and how many more
   players share the last value shown */
export interface DailyRecord {
  key: DailyRecordKey;
  holders: Array<{
    steamId: string;
    persona: string;
    avatar: string | null;
    value: number;
    place: number;
  }>;
  more: number;
}

export interface DailyStandings {
  /* how many final Dailies are counted, and the first one's date */
  dailies: number;
  since: string | null;
  /* everyone with a time on a final Daily, in medal order */
  players: Array<DailyStanding>;
  records: Array<DailyRecord>;
}
