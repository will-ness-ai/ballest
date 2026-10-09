// A Track or Map board's record history, worked out from its Score history (every Entry it
// has held, open and closed, with the Refreshes that first saw, last saw and closed it):
// its Reigns and what changed day by day. The history card on a
// board page draws this and nothing else (components/board/HistoryCard.tsx).
//
// Dates are Refresh starts, so a time is known only to the Refresh that first saw it, and
// one already there when the board was first read was set then or earlier (beforeHistory).
import { SCORE_TICKS_PER_SECOND, plural } from "./rules";

/* one Entry as db/site.ts reads it: times are ISO strings */
export interface HistoryEntry {
  steamId: string;
  persona: string;
  score: number;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string | null;
}

export interface HistoryInput {
  /* the latest Refresh */
  now: string;
  entries: ReadonlyArray<HistoryEntry>;
}

export interface Reign {
  steamId: string;
  persona: string;
  score: number;
  /* the Refresh that first saw it lead, and the one that saw it beaten (null while it stands) */
  from: string;
  to: string | null;
  /* the record before it minus this one, in ticks; null for the first, and for a record
     handed back when its holder left the board, which is slower */
  cut: number | null;
  beforeHistory: boolean;
}

export interface DayRecord {
  steamId: string;
  persona: string;
  score: number;
  /* the record it beat */
  beat: { persona: string; cut: number } | null;
}

export interface DayTopTen {
  steamId: string;
  persona: string;
  score: number;
  /* ticks off the player's previous time; null for a first time */
  cut: number | null;
}

export interface HistoryDay {
  /* a UTC date, YYYY-MM-DD */
  day: string;
  records: Array<DayRecord>;
  topTen: Array<DayTopTen>;
  improved: number;
  firstTimes: number;
}

export interface BoardHistory {
  /* the Refresh that first read the board: where its history begins */
  since: string;
  now: string;
  /* oldest first */
  reigns: Array<Reign>;
  /* newest first; a day nothing new was seen on is left out */
  days: Array<HistoryDay>;
}

const DAY_MS = 86_400_000;

interface E {
  steamId: string;
  persona: string;
  score: number;
  f: number;
  l: number;
  c: number | null;
}

/* Steam's order on a time board: faster first, an equal time to the lower Steam ID */
const byRank = (a: E, b: E) =>
  a.score - b.score || (a.steamId < b.steamId ? -1 : a.steamId > b.steamId ? 1 : 0);
const openAt = (e: E, t: number) => e.f <= t && (e.c === null || e.c > t);
const iso = (t: number) => new Date(t).toISOString();
const utcDay = (t: number) => iso(t).slice(0, 10);

/* An Entry seen by one Refresh and then gone without its player improving on it: one
   Steam removed. It never counts as a record or a day's change. */
function removed(e: E, mine: ReadonlyArray<E>) {
  if (e.c === null || e.f !== e.l) return false;
  return !mine.some((x) => x.f > e.f && x.score < e.score);
}

export function boardHistory(input: HistoryInput): BoardHistory | null {
  const all: Array<E> = input.entries.map((e) => ({
    steamId: e.steamId,
    persona: e.persona,
    score: e.score,
    f: Date.parse(e.firstSeenAt),
    l: Date.parse(e.lastSeenAt),
    c: e.closedAt ? Date.parse(e.closedAt) : null,
  }));
  if (!all.length) return null;
  const now = Date.parse(input.now);

  const byPlayer = new Map<string, Array<E>>();
  for (const e of [...all].sort((a, b) => a.f - b.f)) {
    const mine = byPlayer.get(e.steamId) ?? [];
    mine.push(e);
    byPlayer.set(e.steamId, mine);
  }
  const kept = all.filter((e) => !removed(e, byPlayer.get(e.steamId) ?? []));
  const keep = new Set(kept);
  for (const [id, mine] of byPlayer)
    byPlayer.set(
      id,
      mine.filter((e) => keep.has(e)),
    );
  const ranked = [...kept].sort(byRank);
  const since = Math.min(...all.map((e) => e.f));

  /* the board's top `n` at `t`, in rank order */
  const topAt = (t: number, n: number) => {
    const out: Array<E> = [];
    for (const e of ranked) {
      if (openAt(e, t)) out.push(e);
      if (out.length === n) break;
    }
    return out;
  };
  const moments = [...new Set(kept.flatMap((e) => (e.c === null ? [e.f] : [e.f, e.c])))].sort(
    (a, b) => a - b,
  );
  const top10 = new Map(moments.map((t) => [t, topAt(t, 10)]));

  /* a Reign changes hands only on a faster time: an equal one leaves the record where it is */
  const held: Array<{ e: E; from: number; to: number | null; prev: E | null }> = [];
  for (const t of moments) {
    const lead = top10.get(t)?.[0];
    const last = held.at(-1);
    if (!lead || (last && (last.e === lead || last.e.score === lead.score))) continue;
    if (last) last.to = t;
    held.push({ e: lead, from: t, to: null, prev: last ? last.e : null });
  }
  const reigns: Array<Reign> = held.map((r) => ({
    steamId: r.e.steamId,
    persona: r.e.persona,
    score: r.e.score,
    from: iso(r.from),
    to: r.to === null ? null : iso(r.to),
    /* a record handed back when its holder left the board is slower, and cut nothing */
    cut: r.prev && r.prev.score > r.e.score ? r.prev.score - r.e.score : null,
    beforeHistory: r.from === since,
  }));

  /* what each day brought: everything first seen after the first Refresh */
  /* an Entry's first Reign: a record handed back to it later is not set again */
  const recordAt = new Map<E, (typeof held)[number]>();
  for (const r of held) if (!recordAt.has(r.e)) recordAt.set(r.e, r);
  const days = new Map<string, HistoryDay>();
  for (const e of [...kept].sort((a, b) => a.f - b.f || byRank(a, b))) {
    if (e.f === since) continue;
    const key = utcDay(e.f);
    let d = days.get(key);
    if (!d) {
      d = { day: key, records: [], topTen: [], improved: 0, firstTimes: 0 };
      days.set(key, d);
    }
    const mine = byPlayer.get(e.steamId) ?? [];
    const prev = mine[mine.indexOf(e) - 1] as E | undefined;
    /* a record counts on the day it was set, not a day it was handed back */
    const rec = recordAt.get(e);
    if (rec?.from === e.f)
      d.records.push({
        steamId: e.steamId,
        persona: e.persona,
        score: e.score,
        beat:
          rec.prev && rec.prev.score > e.score
            ? { persona: rec.prev.persona, cut: rec.prev.score - e.score }
            : null,
      });
    else if (top10.get(e.f)?.includes(e))
      d.topTen.push({
        steamId: e.steamId,
        persona: e.persona,
        score: e.score,
        cut: prev ? prev.score - e.score : null,
      });
    if (prev) d.improved++;
    else d.firstTimes++;
  }

  return {
    since: iso(since),
    now: iso(now),
    reigns,
    days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
  };
}

/* ---------- the words the card uses ---------- */

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/* a Refresh's day, UTC: "6 Sep" */
export function dayText(at: string) {
  const d = new Date(at);
  return String(d.getUTCDate()) + " " + MONTHS[d.getUTCMonth()];
}

const WEEKDAYS = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" ");

/* a day of the day list (YYYY-MM-DD, UTC): "Saturday 3 Oct" */
export function longDayText(day: string) {
  const d = new Date(day + "T00:00:00Z");
  return WEEKDAYS[d.getUTCDay()] + " " + dayText(d.toISOString());
}

/* when a Reign began: a record already there when the board was first read was set then or
   earlier */
export const setText = (r: Reign) => dayText(r.from) + (r.beforeHistory ? " or earlier" : "");

/* how long a Reign stood, in whole days */
export function heldText(r: Reign) {
  if (r.to === null) return "holds it";
  const days = Math.floor((Date.parse(r.to) - Date.parse(r.from)) / DAY_MS);
  return days ? String(days) + (days === 1 ? " day" : " days") : "under a day";
}

/* a gap in seconds, and a cut as a gap taken off; one under a millisecond keeps the digits
   that make it non-zero, since a board counts in hundred-thousandths */
export const gapText = (ticks: number) =>
  (ticks / SCORE_TICKS_PER_SECOND).toFixed(ticks < SCORE_TICKS_PER_SECOND / 1000 ? 5 : 3) + "s";
export const cutText = (ticks: number) => "−" + gapText(ticks);

/* "World record · 20 changes since 6 Sep", or "No changes since 6 Sep" */
export function changesText(h: BoardHistory) {
  const n = h.reigns.length - 1;
  const since = " since " + dayText(h.since);
  return n ? "World record · " + plural(n, "change", "changes") + since : "No changes" + since;
}
