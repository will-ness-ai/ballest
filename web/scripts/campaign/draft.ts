// The pure half of `pnpm --silent campaign` (scripts/campaign.ts): a draft Campaign from the
// Maps tools/workshop_maps.py found, each Map's label as the rail will show it, what stands in
// the way of the entry, and the entry itself, written into campaigns.ts. Tested in
// test/campaign-tool.test.ts.
import {
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

/* a title as a path: lowercase words joined by - ("Stoxy's mini golf" is stoxys-mini-golf) */
export const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replaceAll("'", "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface Row {
  no: string;
  pfid: string;
  label: string;
  title: string;
  flags: Array<string>;
}

/* each Map as the rail will label it, with what is wrong with it: by another maker, in a
   Campaign already, not on the site yet, or a label that says its number twice ("01 1 of 8") */
export function rows(c: Campaign, found: ReadonlyArray<Found>): Array<Row> {
  return found.map((m) => {
    const flags: Array<string> = [];
    if (m.cid !== c.creatorId) flags.push(`by ${m.creator}`);
    const home = campaignOfMap(m.pfid);
    if (home) flags.push(`in ${home.campaign.slug}`);
    if (m.on_site === false) flags.push("not on the site yet");
    const name = mapName(c, m.pfid, m.title);
    const lead = name === null ? null : /^[a-z]?0*(\d+)/i.exec(name);
    if (lead && Number(lead[1]) === mapNumber(c, m.pfid)) flags.push("label repeats its number");
    const label = mapLabel(c, m.pfid, m.title);
    return { no: mapNo(c, m.pfid), pfid: m.pfid, label, title: m.title, flags };
  });
}

/* the entry as Prettier writes it, indented for CAMPAIGNS */
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

/* a value as a row's cell: quoted when it holds a comma, a colon or a quote */
export const cell = (v: string) => (/[,:"]/.test(v) ? JSON.stringify(v) : v);
