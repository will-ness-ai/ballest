// What the Daily Report says, as plain strings: the channel message (the day, the counts, Since
// yesterday) and the thread's messages (the map lists and the longest-standing records). The
// settled design is round 3 of the prototype on branch claude/prototype-daily-report.
import { formatTime, SCORE_TICKS_PER_SECOND } from "../domain.js";
import type { StandingsImage } from "../render/scenes.js";
import type { DatedRecord } from "./records.js";
import {
  CHANGES_SHOWN,
  DAY_MS,
  type Change,
  type ListedMap,
  type ListedTrack,
  type Report,
  type Stat,
} from "./report.js";

/** Discord's cap on a bot message's text. */
export const MESSAGE_LIMIT = 2000;
/** Where the links go: each Map's and Track's page on the site. */
const SITE_URL = "https://ballestrecords.com";

/** The four boards' headings, in the image. */
export const BOARD_TITLE: Record<Stat, string> = {
  played: "Most Maps played",
  author: "Most Author Medals",
  wr: "Most world records",
  top5: "Most top 5s",
};

/** Neutralise Discord markdown and mentions in a persona or Map title. */
export const escape = (s: string) =>
  s
    .replace(/[\\*_~`|>[\]]/g, (c) => `\\${c}`)
    .replaceAll("@", "@​")
    .replaceAll("<", "<​");

/** A masked link; the <> stop Discord unfurling an embed. */
const siteLink = (text: string, path: string) => `[${escape(text)}](<${SITE_URL}${path}>)`;
/** The Map's page on the site. */
const mapLink = (m: ListedMap) => siteLink(m.title || m.pfid, `/map/${m.pfid}`);
/** The Track's board on the site. */
const trackLink = (t: ListedTrack) => siteLink(t.label, `/board/${t.board}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bold = (name: string) => `**${escape(name)}**`;

const utc = (at: number, options: Intl.DateTimeFormatOptions) =>
  new Date(at).toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
/** "Sunday 4 October" */
export const dayTitle = (at: number) =>
  utc(at, { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "4 Oct 2026" (spelled out: en-GB writes September "Sept") */
export const shortDate = (at: number) => {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
};

export const counts = (r: Report) =>
  `${r.maps.toLocaleString("en")} Workshop Maps · ${r.players.toLocaleString("en")} players`;

const changeLine = (c: Change): string => {
  switch (c.kind) {
    case "trackRecord":
      return `- 🏆 ${bold(c.by)} took ${trackLink(c.track)} from ${escape(c.from)} — ${formatTime(c.score)} (-${(c.gain / SCORE_TICKS_PER_SECOND).toFixed(3)}s)`;
    case "mapRecord":
      return `- 🥇 ${bold(c.by)} took ${mapLink(c.map)} from ${escape(c.from)} — ${formatTime(c.score)} · *${plural(c.players, "player")}*`;
    case "firstFinish":
      return `- 🎉 ${mapLink(c.map)} finished for the first time, by ${bold(c.by)} · *${plural(c.players, "player")}*`;
    case "firstAuthor":
      return `- 🎯 ${bold(c.by)} claimed the first Author Medal on ${mapLink(c.map)} · *${plural(c.players, "player")}*`;
  }
};

const POINTER =
  "-# Maps nobody has finished, unclaimed Author Medals and the longest-standing records are in the thread ↓";

/**
 * The channel message: the day, the counts, and Since yesterday (the Circuit, then up to
 * CHANGES_SHOWN Workshop changes, fewer if the message would pass Discord's limit).
 */
export const headMessage = (r: Report): string => {
  // The day as the title (round 3's B), the data's age as a Discord timestamp, which each
  // reader sees in their own words (round 3's D).
  const asOf =
    r.refreshedAt === null ? "" : ` · data as of <t:${Math.floor(r.refreshedAt / 1000)}:R>`;
  const head = [
    `# ${dayTitle(r.at)}`,
    `-# Workshop standings · ${counts(r)}${asOf}`,
    "## 📅 Since yesterday",
  ];
  const circuit = r.circuitChanges.map(changeLine);
  const workshop = r.workshopChanges.map(changeLine);
  const newMaps = r.newMaps > 0 ? [`- 🆕 ${plural(r.newMaps, "new Map")} on the Workshop`] : [];
  for (let shown = Math.min(CHANGES_SHOWN, workshop.length); ; shown--) {
    const rest = workshop.length - shown;
    const lines = [
      ...circuit,
      ...workshop.slice(0, shown),
      ...(rest > 0 ? [`- …and ${rest} more on smaller Workshop Maps`] : []),
      ...newMaps,
    ];
    const text = [...head, ...(lines.length > 0 ? lines : ["- Nothing changed."]), POINTER].join(
      "\n",
    );
    if (text.length <= MESSAGE_LIMIT || shown === 0) return text;
  }
};

/** What the standings image shows: the day, the counts and the four boards. */
export const standingsImage = (r: Report): StandingsImage => ({
  title: dayTitle(r.at),
  subtitle: `Workshop standings · ${counts(r)}`,
  boards: r.boards.map((b) => ({
    title: BOARD_TITLE[b.stat],
    rows: b.rows.map((row, i) => ({
      name: row.persona,
      n: row.n,
      move: row.was === null ? "new" : row.was - (i + 1),
      gain: row.gain,
    })),
    out: b.out.map((o) => o.persona),
  })),
});

export const threadName = (r: Report) => `Maps and records · ${shortDate(r.at)}`;

const recordLine = (pos: number, rec: DatedRecord, at: number) => {
  const where = "track" in rec.where ? trackLink(rec.where.track) : mapLink(rec.where.map);
  const days = Math.floor((at - rec.setAt) / DAY_MS);
  return `> ${pos}. ${bold(rec.persona)} — ${where} in ${formatTime(rec.score)} — set ${shortDate(rec.setAt)} (${plural(days, "day")} ago)`;
};

const FOOT =
  "-# Creators count on their own Maps only by beating their own Author time. Lists skip Maps up for less than a day. Source: Steam leaderboards.";

/** The thread's sections, before packing into messages. */
export const threadSections = (
  r: Report,
  oldest: {
    readonly tracks: ReadonlyArray<DatedRecord>;
    readonly maps: ReadonlyArray<DatedRecord>;
  },
): Array<string> => {
  const section = (title: string, lines: ReadonlyArray<string>, empty: string) =>
    [`> ### ${title}`, ...(lines.length > 0 ? lines : [`> - ${empty}`])].join("\n");
  return [
    section(
      "🚫 Maps nobody has finished",
      r.unfinished.map((m) => `> - ${mapLink(m)}`),
      "none",
    ),
    section(
      "🎯 Author Medals still unclaimed",
      r.unclaimed.map((m) => `> - ${mapLink(m)} — ${plural(m.finishers, "finisher")}`),
      "none",
    ),
    ...(oldest.tracks.length > 0
      ? [
          section(
            "🕰️ Longest-standing Circuit records",
            oldest.tracks.map((rec, i) => recordLine(i + 1, rec, r.at)),
            "",
          ),
        ]
      : []),
    ...(oldest.maps.length > 0
      ? [
          section(
            "🕰️ Longest-standing Workshop records",
            oldest.maps.map((rec, i) => recordLine(i + 1, rec, r.at)),
            "",
          ),
        ]
      : []),
    FOOT,
  ];
};

/**
 * Sections joined by blank lines into as few messages as fit MESSAGE_LIMIT. A section stays
 * whole where it can; one too long for a message (a long map list) is split between lines.
 */
export const pack = (sections: ReadonlyArray<string>, limit = MESSAGE_LIMIT): Array<string> => {
  const pieces = sections.flatMap((s) => {
    if (s.length <= limit) return [s];
    const parts: Array<string> = [];
    let part = "";
    for (const line of s.split("\n")) {
      if (part !== "" && part.length + 1 + line.length > limit) {
        parts.push(part);
        part = line;
      } else part = part === "" ? line : `${part}\n${line}`;
    }
    return [...parts, part];
  });
  const messages: Array<string> = [];
  let current = "";
  for (const piece of pieces) {
    const joined = current === "" ? piece : `${current}\n\n${piece}`;
    if (current !== "" && joined.length > limit) {
      messages.push(current);
      current = piece;
    } else current = joined;
  }
  return current === "" ? messages : [...messages, current];
};
