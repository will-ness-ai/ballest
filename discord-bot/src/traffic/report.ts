// What the Traffic Report says, from plain data: one day of the site's visits (Plausible) and
// one day of Google search (Search Console), each against the week before it. Either half can
// be missing (not set up, or its read failed), and the message says so in one line.
import { Data } from "effect";
import { daysBefore } from "../everyDay.js";

/** A half's source couldn't be read; the post says why, and so does ops. */
export class TrafficUnavailable extends Data.TaggedError("TrafficUnavailable")<{
  readonly reason: string;
}> {}

/** A day's numbers, and their mean over the seven days before it (null without history). */
export interface Compared {
  readonly day: number;
  readonly weekMean: number | null;
}

/** A day's value against the mean of the seven days before it, a day the series lacks counting
 * as 0 (Search Console leaves out days nobody saw the site), and no mean without any of them. */
export const compared = (
  days: ReadonlyArray<{ date: string; n: number }>,
  date: string,
): Compared => {
  const day = days.find((d) => d.date === date)?.n ?? 0;
  const week = days.filter((d) => d.date < date && d.date >= daysBefore(date, 7));
  return {
    day,
    weekMean: week.length ? week.reduce((s, d) => s + d.n, 0) / 7 : null,
  };
};

/** A row of a top-five list: a page, a source or a search, and its count. */
export interface Ranked {
  readonly name: string;
  readonly n: number;
}

/** One day of the site's own analytics (Plausible), in the site's time zone. */
export interface Visits {
  readonly date: string;
  readonly visitors: Compared;
  readonly pageviews: Compared;
  /** seconds, and percent */
  readonly visitDuration: number;
  readonly bounceRate: number;
  readonly pages: ReadonlyArray<Ranked>;
  readonly sources: ReadonlyArray<Ranked>;
}

/** A search row: what was searched (or the page found), its clicks, impressions and position. */
export interface SearchRow {
  readonly name: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

/** The newest day Search Console has (it runs about two days behind). */
export interface Search {
  readonly date: string;
  readonly clicks: Compared;
  readonly impressions: Compared;
  /** the impression-weighted average position, 1 is the top */
  readonly position: number;
  readonly queries: ReadonlyArray<SearchRow>;
  readonly pages: ReadonlyArray<SearchRow>;
  /** searches the site showed up for on that day and on none of the 28 days before */
  readonly newQueries: ReadonlyArray<string>;
  /** each submitted sitemap's errors and warnings, and when Google last read it */
  readonly sitemaps: ReadonlyArray<{
    readonly path: string;
    readonly errors: number;
    readonly warnings: number;
    readonly lastRead: string | null;
  }>;
}

/** A half of the report: its data, or why it isn't there. */
export type Half<A> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Off" }
  | { readonly _tag: "Failed"; readonly reason: string };

const SITE = "https://ballestrecords.com";

const count = (n: number) => Math.round(n).toLocaleString("en-US");

/** "+12% on the week" against the week's mean, or nothing without one. */
export const change = ({ day, weekMean }: Compared) => {
  if (weekMean === null) return "";
  if (weekMean === 0) return day === 0 ? " (same as the week)" : " (new this week)";
  const pct = Math.round(((day - weekMean) / weekMean) * 100);
  return ` (${pct >= 0 ? "+" : ""}${pct}% on the week's ${count(weekMean)} a day)`;
};

/** "Saturday 17 October" for a "2026-10-17" */
export const dateLabel = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const duration = (s: number) =>
  s < 60
    ? `${Math.round(s)}s`
    : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

/** A site path as a link that doesn't unfurl, or the path alone for one that isn't a path. */
const pageLink = (path: string) => (path.startsWith("/") ? `[${path}](<${SITE}${path}>)` : path);

/** A Search Console page is a full URL; shown by its path. */
const pathOf = (url: string) => (url.startsWith(SITE) ? url.slice(SITE.length) || "/" : url);

const list = (rows: ReadonlyArray<string>) => (rows.length ? rows.join(" · ") : "none");

const visitsLines = (v: Visits) => [
  `## Visits · ${dateLabel(v.date)}`,
  `**${count(v.visitors.day)}** visitors${change(v.visitors)}, **${count(v.pageviews.day)}** pageviews${change(v.pageviews)}`,
  `Visits last ${duration(v.visitDuration)} on average; ${Math.round(v.bounceRate)}% leave after one page.`,
  `**Top pages** ${list(v.pages.map((p) => `${pageLink(p.name)} ${count(p.n)}`))}`,
  `**Sources** ${list(v.sources.map((s) => `${s.name} ${count(s.n)}`))}`,
];

const searchLines = (s: Search) => {
  const ctr = s.impressions.day > 0 ? (s.clicks.day / s.impressions.day) * 100 : 0;
  const row = (r: SearchRow, name: string) =>
    `${name} ${count(r.clicks)} clicks, ${count(r.impressions)} seen, #${r.position.toFixed(1)}`;
  const sitemaps = s.sitemaps.map((m) => {
    const read =
      m.lastRead === null ? "not read yet" : `read ${dateLabel(m.lastRead.slice(0, 10))}`;
    const problems =
      m.errors + m.warnings === 0 ? "no errors" : `${m.errors} errors, ${m.warnings} warnings`;
    return `${pathOf(m.path)}: ${read}, ${problems}`;
  });
  return [
    `## Google search · ${dateLabel(s.date)}`,
    `**${count(s.clicks.day)}** clicks${change(s.clicks)} from **${count(s.impressions.day)}** times in results${change(s.impressions)}; ${ctr.toFixed(1)}% clicked, average position ${s.position.toFixed(1)}.`,
    `**Searches** ${list(s.queries.map((q) => row(q, `"${q.name}"`)))}`,
    `**Pages** ${list(s.pages.map((p) => row(p, pageLink(pathOf(p.name)))))}`,
    ...(s.newQueries.length ? [`**New searches** ${list(s.newQueries.map((q) => `"${q}"`))}`] : []),
    `**Sitemap** ${list(sitemaps)}`,
  ];
};

const missing = (what: string, half: Half<unknown>) =>
  half._tag === "Off"
    ? `_${what}: not set up._`
    : `_${what}: couldn't be read (${half._tag === "Failed" ? half.reason : ""})._`;

/** The whole post. Each list is a top five, so it fits Discord's 2000 characters; the cut is a last resort. */
export const trafficMessage = (visits: Half<Visits>, search: Half<Search>) =>
  [
    ...(visits._tag === "Ok" ? visitsLines(visits.value) : [missing("Visits", visits)]),
    "",
    ...(search._tag === "Ok" ? searchLines(search.value) : [missing("Google search", search)]),
  ]
    .join("\n")
    .slice(0, 2000);
