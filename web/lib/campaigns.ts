// The Campaigns: player-made runs of Workshop Maps that we curate and rank the way the game
// ranks a Circuit season (CONTEXT.md, "Campaign"). The game knows nothing of them, so this
// list is the only place one exists. Adding one is one entry here (docs/site.md); the
// tests in test/campaigns.test.ts fail on a list that doesn't hold together.
//
// A Campaign's standings are a derived board, OverallCampaign_<slug>, worked out on every
// read from its Maps' boards (db/boards.ts). The Overall prefix makes it a points board to
// isPoints and board_kind with no special case.

export interface Campaign {
  /* its path, /campaign/<slug>: lowercase words joined by - */
  slug: string;
  title: string;
  /* the maker, as their Workshop name reads */
  creator: string;
  /* the maker's Steam ID */
  creatorId: string;
  /* the Maps by Workshop ID, in the maker's order */
  maps: ReadonlyArray<string>;
}

export const CAMPAIGNS: ReadonlyArray<Campaign> = [
  {
    slug: "solar-trials",
    title: "Solar Trials",
    creator: "habibal223366977",
    creatorId: "76561199154600151",
    maps: [
      "3805399883",
      "3805394429",
      "3805391903",
      "3805383837",
      "3805286915",
      "3805279771",
      "3805274484",
      "3805269048",
      "3805413302",
    ],
  },
  {
    slug: "velocity-trials",
    title: "Velocity Trials",
    creator: "habibal223366977",
    creatorId: "76561199154600151",
    maps: ["3803908791", "3803910868", "3803919944", "3803929459", "3803937353"],
  },
  {
    slug: "tilted-campaign",
    title: "Tilted Campaign",
    creator: "Helvetica Standard",
    creatorId: "76561198329712885",
    maps: ["3818800453", "3818796364", "3818793772", "3818792773"],
  },
  {
    slug: "miniblack",
    title: "Miniblack",
    creator: "Raincake",
    creatorId: "76561198324121617",
    maps: [
      "3811078255",
      "3811099010",
      "3811155056",
      "3812300011",
      "3812315670",
      "3812537702",
      "3813953489",
      "3814363275",
      "3814672448",
      "3815119058",
    ],
  },
  {
    slug: "ajc",
    title: "AJC",
    creator: "Action Jackson",
    creatorId: "76561198008697957",
    maps: ["3646349274", "3737890903", "3744752972", "3762695115", "3788055152"],
  },
];

/* what is wrong with a list of Campaigns, in words; empty when it holds together */
export function campaignProblems(list: ReadonlyArray<Campaign>): Array<string> {
  const out: Array<string> = [];
  const slugs = new Set<string>();
  const homes = new Map<string, string>();
  for (const c of list) {
    if (slugs.has(c.slug)) out.push(`slug "${c.slug}" is used twice`);
    slugs.add(c.slug);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug))
      out.push(`slug "${c.slug}" is not lowercase words joined by -`);
    if (!c.maps.length) out.push(`"${c.slug}" has no Maps`);
    for (const pfid of c.maps) {
      if (!/^\d{1,20}$/.test(pfid))
        out.push(`"${c.slug}" lists "${pfid}", which is not a Workshop ID`);
      const home = homes.get(pfid);
      if (home !== undefined) out.push(`Map ${pfid} is in "${home}" and "${c.slug}"`);
      homes.set(pfid, c.slug);
    }
  }
  return out;
}

const PREFIX = "OverallCampaign_";

/* a Campaign's standings, as a board name */
export const campaignBoard = (c: Campaign) => PREFIX + c.slug;

export const campaignOf = (slug: string) => CAMPAIGNS.find((c) => c.slug === slug) ?? null;

export const campaignOfBoard = (name: string) =>
  name.startsWith(PREFIX) ? campaignOf(name.slice(PREFIX.length)) : null;

/* the Campaign a Map is in and its place there (0-based), or null; a Map is in one at most */
export function campaignOfMap(pfid: string): { campaign: Campaign; index: number } | null {
  for (const campaign of CAMPAIGNS) {
    const index = campaign.maps.indexOf(pfid);
    if (index >= 0) return { campaign, index };
  }
  return null;
}

/* a Map's number in its Campaign, as a Track's is in its season: its place in the maker's
   order, two digits */
export const mapNo = (c: Campaign, pfid: string) =>
  String(c.maps.indexOf(pfid) + 1).padStart(2, "0");

/* a Map's title inside its Campaign: the part after the Campaign's name, when it starts
   with it ("Solar Trials Mercury" is Mercury), else the whole title */
export function shortTitle(c: Campaign, title: string) {
  const name = c.title.toLowerCase();
  if (!title.toLowerCase().startsWith(name)) return title;
  return title.slice(name.length).trim() || title;
}
