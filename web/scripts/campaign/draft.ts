// The pure half of `pnpm --silent campaign` (scripts/campaign.ts): a draft Campaign from the
// Maps tools/workshop_maps.py found, each Map's label as the rail will show it, what stands in
// the way of the entry, and the entry itself, written into campaigns.ts. Tested in
// test/campaign-tool.test.ts.
import {
  CAMPAIGNS,
  type Campaign,
  campaignOfMap,
  mapLabel,
  mapName,
  mapNo,
  mapNumber,
} from "../../lib/campaigns";

/* one Map as `workshop_maps.py --json` prints it */
export interface Found {
  pfid: string;
  title: string;
  creator: string;
  cid: string;
  created: number;
  /* null when the site couldn't be read */
  on_site: boolean | null;
}

/* the words every title starts with, without a trailing number or dash ("Limbo campaign"
   from "Limbo campaign 1 of 8" and "Limbo campaign A08 of 8"), or null when they share none */
export function sharedTitle(titles: ReadonlyArray<string>): string | null {
  const split = titles.map((t) => t.trim().split(/\s+/));
  const shared: Array<string> = [];
  for (const [i, word] of (split[0] ?? []).entries()) {
    if (!split.every((w) => w[i]?.toLowerCase() === word.toLowerCase())) break;
    shared.push(word);
  }
  while (shared.length && /^[\d\W]+$/.test(shared[shared.length - 1])) shared.pop();
  return shared.length ? shared.join(" ") : null;
}

/* a title as a path: lowercase words joined by -, without a closing "campaign" (Stoxy's mini golf
   is stoxys-mini-golf, Limbo campaign is limbo) */
export const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/\s+campaigns?\s*$/, "")
    .replaceAll("'", "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface Row {
  no: string;
  pfid: string;
  label: string;
  title: string;
  /* what stops the entry: a Map another Campaign has (campaignProblems would fail the tests) */
  problems: Array<string>;
  /* what to look at before writing it: another maker, a Map the site doesn't list yet (a
     Refresh lists it), or a label that says its number twice ("01 1 of 8") */
  notes: Array<string>;
}

/* each Map as the rail will label it, with what stops the entry and what to look at */
export function rows(c: Campaign, found: ReadonlyArray<Found>): Array<Row> {
  return found.map((m) => {
    const problems: Array<string> = [];
    const notes: Array<string> = [];
    const home = campaignOfMap(m.pfid);
    if (home) problems.push(`in ${home.campaign.slug}`);
    if (m.cid !== c.creatorId) notes.push(`by ${m.creator}`);
    if (m.on_site === false) notes.push("not on the site yet");
    const name = mapName(c, m.pfid, m.title);
    const lead = name === null ? null : /^[a-z]?0*(\d+)/i.exec(name);
    if (lead && Number(lead[1]) === mapNumber(c, m.pfid)) notes.push("label repeats its number");
    const label = mapLabel(c, m.pfid, m.title);
    return { no: mapNo(c, m.pfid), pfid: m.pfid, label, title: m.title, problems, notes };
  });
}

/* the entry as Prettier writes it, indented for CAMPAIGNS (the tool runs Prettier after writing
   it, for what this doesn't cover) */
export function entryText(c: Campaign): string {
  const ids = c.maps.map((p) => `"${p}"`);
  const oneLine = `    maps: [${ids.join(", ")}],`;
  const maps =
    oneLine.length <= 100
      ? oneLine
      : ["    maps: [", ...ids.map((id) => `      ${id},`), "    ],"].join("\n");
  return [
    "  {",
    `    slug: ${JSON.stringify(c.slug)},`,
    `    title: ${JSON.stringify(c.title)},`,
    `    creator: ${JSON.stringify(c.creator)},`,
    `    creatorId: ${JSON.stringify(c.creatorId)},`,
    maps,
    "  },",
  ].join("\n");
}

/* campaigns.ts with the entry appended to CAMPAIGNS, or null when the list's end can't be found */
export function insertEntry(source: string, entry: string): string | null {
  const start = source.indexOf("export const CAMPAIGNS");
  const end = start < 0 ? -1 : source.indexOf("\n];", start);
  if (end < 0) return null;
  return `${source.slice(0, end)}\n${entry}${source.slice(end)}`;
}

export type Plan =
  /* the Maps' titles share no words, so the Campaign needs a --title */
  | { kind: "untitled" }
  /* these Maps are a Campaign already */
  | { kind: "added"; campaign: Campaign }
  | {
      kind: "draft";
      campaign: Campaign;
      rows: Array<Row>;
      /* what stops the entry, one line each */
      problems: Array<string>;
      /* what to look at before writing it, one line each */
      notes: Array<string>;
      /* which problems there are, for the next step: a Map another Campaign has, the slug */
      mapsTaken: boolean;
      slugTaken: boolean;
      entry: string;
    };

/* what `draft` makes of the Maps workshop_maps.py found (and the IDs that found none): the
   Campaign, named by --title and --slug or from its Maps' titles, made by whoever made most
   of them, with its rows, problems, notes and entry. `list` stands in for CAMPAIGNS in the
   no-op, slug and maker checks; which Campaign has a Map is always read from CAMPAIGNS */
export function plan(
  found: ReadonlyArray<Found>,
  missing: ReadonlyArray<string>,
  named: { title?: string; slug?: string },
  list: ReadonlyArray<Campaign> = CAMPAIGNS,
): Plan {
  const title = named.title ?? sharedTitle(found.map((m) => m.title));
  if (title === null) return { kind: "untitled" };
  const count = (cid: string) => found.filter((m) => m.cid === cid).length;
  const maker = [...found].sort((a, b) => count(b.cid) - count(a.cid))[0];
  const campaign: Campaign = {
    slug: named.slug ?? slugOf(title),
    title,
    creator: maker.creator,
    creatorId: maker.cid,
    maps: found.map((m) => m.pfid),
  };
  const added = list.find((x) => x.maps.join() === campaign.maps.join());
  if (added) return { kind: "added", campaign: added };

  const table = rows(campaign, found);
  const line = (r: Row, what: Array<string>) => `${r.no} ${r.pfid}: ${what.join(", ")}`;
  const problems = table.filter((r) => r.problems.length).map((r) => line(r, r.problems));
  const taken = list.find((x) => x.slug === campaign.slug);
  if (taken) problems.push(`slug "${campaign.slug}" is ${taken.title}'s`);
  const notes = [
    ...missing.map(
      (id) => `${id}: no Map (not this game's, not public, or newer than Steam's catalogue)`,
    ),
    ...table.filter((r) => r.notes.length).map((r) => line(r, r.notes)),
  ];
  const elsewhere = list.find((x) => x.creatorId === campaign.creatorId);
  if (elsewhere)
    notes.push(
      `${campaign.creator} also made ${elsewhere.slug}: share their creator fields as a constant`,
    );
  return {
    kind: "draft",
    campaign,
    rows: table,
    problems,
    notes,
    mapsTaken: table.some((r) => r.problems.length),
    slugTaken: taken !== undefined,
    entry: entryText(campaign),
  };
}

/* a value as a row's cell: quoted when it holds a comma, a colon or a quote */
export const cell = (v: string) => (/[,:"]/.test(v) ? JSON.stringify(v) : v);
