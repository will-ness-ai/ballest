// What a Daily Post's card says (spec #268), as plain data and text: the Daily's number, the
// header, the podium with ties, the Medal times, and the thread's name. Pure, so the schedule and
// `pnpm daily-post` say exactly the same, and the tests read it without Discord.
import { type Medals, SCORE_TICKS_PER_SECOND } from "../domain.js";
import { escape } from "../report/messages.js";

/** One Daily, as the developers' API names it. Times in ms. */
export interface Challenge {
  /** "2026-10-18": the Daily's name, and the key its Daily Post is recorded under. */
  readonly date: string;
  readonly pfid: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number;
  /** The Daily's own Steam board, apart from the Map's all-time one. */
  readonly boardId: number;
}

/** The Daily's Map as its Workshop page describes it. */
export interface DailyMap {
  readonly title: string;
  readonly maker: string;
  readonly previewUrl: string;
  readonly medals: Medals;
}

/** One read of the Daily's board: how many players it holds, and its top 3 by name. */
export interface BoardRead {
  readonly players: number;
  readonly top: ReadonlyArray<{ readonly name: string; readonly ticks: number }>;
}

/** Everything the live card is drawn from. */
export interface DailyView {
  readonly date: string;
  readonly pfid: string;
  readonly title: string;
  readonly maker: string;
  readonly endsAt: number;
  readonly medals: Medals;
  /** Null until the board has been read once. */
  readonly board: BoardRead | null;
  /** When `board` was read: the card's "Updated". */
  readonly readAt: number;
}

export const viewOf = (
  challenge: Challenge,
  map: DailyMap,
  board: BoardRead | null,
  readAt: number,
): DailyView => ({
  date: challenge.date,
  pfid: challenge.pfid,
  title: map.title || challenge.title,
  maker: map.maker,
  endsAt: challenge.endsAt,
  medals: map.medals,
  board,
  readAt,
});

const DAY_MS = 86_400_000;
/** Daily #1. */
const FIRST_DAILY = Date.UTC(2026, 7, 20);

const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Dailies count by date from 20 August 2026, #1. */
export const dailyNumber = (date: string): number =>
  Math.round((dayStart(date) - FIRST_DAILY) / DAY_MS) + 1;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sun 18 Oct" */
const shortDay = (date: string) => {
  const d = new Date(dayStart(date));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** A Discord timestamp, shown in each reader's own time zone. */
const stamp = (at: number, style: "R" | "t" | "f") => `<t:${Math.floor(at / 1000)}:${style}>`;
const bold = (s: string) => `**${escape(s)}**`;
const PLACES = ["🥇", "🥈", "🥉"];

/** A run time in whole milliseconds, cut rather than rounded: the site's `fmtTime`. */
const millis = (ticks: number) => Math.floor((ticks * 1000) / SCORE_TICKS_PER_SECOND);

/**
 * A run time as the site shows it, 0:08.532: cut to the thousandth, never rounded, so the Daily
 * Post and the site's board agree. (Matches round, through `formatTime`.)
 */
export const dailyTime = (ticks: number): string => {
  const ms = millis(ticks);
  return `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

/** The top 3, an equal time sharing the place above it: 🥇 🥇 🥉. */
const podium = (top: BoardRead["top"]) =>
  top.slice(0, 3).map((e, i) => {
    const place = top.findIndex((o) => o.ticks === e.ticks);
    return `${PLACES[place < 0 ? i : place]} ${bold(e.name)} ${dailyTime(e.ticks)}`;
  });

const medalTime = (seconds: number) => dailyTime(Math.round(seconds * SCORE_TICKS_PER_SECOND));

/** The card's three blocks of text. */
export const cardText = (v: DailyView) => {
  const first = v.board?.top[0];
  const stats =
    v.board === null || first === undefined
      ? "No times yet"
      : [
          `**${v.board.players}** ${v.board.players === 1 ? "player" : "players"} · fastest **${dailyTime(first.ticks)}**`,
          ...podium(v.board.top),
        ].join("\n");
  const { author, gold, silver, bronze } = v.medals;
  return {
    header: `-# DAILY #${dailyNumber(v.date)} · ${shortDay(v.date).toUpperCase()}\n# ${escape(v.title)}\nby ${bold(v.maker)} · ends ${stamp(v.endsAt, "R")}`,
    stats,
    foot: `Author ${medalTime(author)} · Gold ${medalTime(gold)} · Silver ${medalTime(silver)} · Bronze ${medalTime(bronze)}\n-# Updated ${stamp(v.readAt, "R")}`,
  };
};

/** What the card shows apart from when it was updated: an edit happens only when this changes. */
export const shownKey = (v: DailyView): string => JSON.stringify({ ...v, readAt: 0 });

/** "Daily #60 · the drop · Sun 18 Oct" (Discord caps a thread's name at 100). */
export const threadName = (v: Pick<DailyView, "date" | "title">): string =>
  `Daily #${dailyNumber(v.date)} · ${v.title} · ${shortDay(v.date)}`.slice(0, 100);
