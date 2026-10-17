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

/* makers of more than one Campaign, each written once */
const HABIBAL = { creator: "habibal223366977", creatorId: "76561199154600151" };
const ACTION_JACKSON = { creator: "Action Jackson", creatorId: "76561198008697957" };

export const CAMPAIGNS: ReadonlyArray<Campaign> = [
  {
    slug: "solar-trials",
    title: "Solar Trials",
    ...HABIBAL,
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
    ...HABIBAL,
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
    ...ACTION_JACKSON,
    maps: ["3646349274", "3737890903", "3744752972", "3762695115", "3788055152"],
  },
  {
    slug: "aj",
    title: "AJ",
    ...ACTION_JACKSON,
    maps: [
      "3619755748",
      "3595665408",
      "3591825761",
      "3592062662",
      "3591823909",
      "3591813905",
      "3604397166",
      "3620234858",
      "3624133638",
      "3642850471",
    ],
  },
  {
    slug: "hydro",
    title: "Hydro",
    ...ACTION_JACKSON,
    maps: ["3594957354", "3595338265", "3598520302", "3628579558", "3802390659"],
  },
  {
    slug: "ancient",
    title: "Ancient",
    ...ACTION_JACKSON,
    maps: ["3602760496", "3603850726", "3609081915", "3637508568"],
  },
  {
    slug: "madhouse",
    title: "Madhouse",
    ...ACTION_JACKSON,
    maps: ["3619178150", "3626117259", "3631235757", "3746019892"],
  },
  {
    slug: "neon",
    title: "Neon",
    ...ACTION_JACKSON,
    maps: ["3613242012", "3620833811", "3626852353", "3748587455"],
  },
  {
    slug: "ninja",
    title: "Ninja",
    ...ACTION_JACKSON,
    maps: ["3605138459", "3607096927", "3612357898"],
  },
  {
    slug: "minitower",
    title: "MiniTower",
    ...ACTION_JACKSON,
    maps: ["3622417599", "3623062895", "3623920896"],
  },
  {
    slug: "speedway",
    title: "Speedway",
    ...ACTION_JACKSON,
    maps: ["3627401234", "3627753428", "3629139384"],
  },
  {
    slug: "8p",
    title: "8p",
    ...ACTION_JACKSON,
    maps: ["3640116850", "3640654366", "3640866380", "3642152991", "3642195386"],
  },
  {
    slug: "escape",
    title: "Escape",
    creator: "Slati Jnr",
    creatorId: "76561198047392190",
    maps: ["3603923125", "3605632707", "3614673281"],
  },
  {
    slug: "numbers",
    title: "Numbers",
    creator: "Acehole Viscunty",
    creatorId: "76561199344200746",
    maps: [
      "3802885119",
      "3802896653",
      "3802928235",
      "3802938803",
      "3802951860",
      "3803134364",
      "3803232786",
      "3803242804",
      "3803265605",
      "3803278949",
    ],
  },
  {
    slug: "3-piece",
    title: "3 Piece",
    creator: "NeM™",
    creatorId: "76561198004413594",
    maps: [
      "3803993639",
      "3803996533",
      "3803998516",
      "3804003840",
      "3804005195",
      "3804008300",
      "3804009819",
      "3804013160",
      "3804016296",
      "3804018504",
    ],
  },
  {
    slug: "u10s",
    title: "U10s",
    creator: "larsandreas2010",
    creatorId: "76561199800498989",
    maps: ["3807433356", "3807445665", "3807494763", "3807762066", "3807797202"],
  },
  {
    slug: "avg-circuit",
    title: "AVG Circuit",
    creator: "AvgRon",
    creatorId: "76561198216876299",
    maps: ["3797182398", "3798819807", "3803569863", "3808529641"],
  },
  {
    slug: "mind-trials",
    title: "Mind Trials",
    ...HABIBAL,
    maps: ["3821602774", "3821588330", "3821590642", "3821598041", "3821600974"],
  },
  {
    slug: "stoxys-mini-golf",
    title: "Stoxy's mini golf",
    creator: "stoxy999",
    creatorId: "76561198055494306",
    maps: [
      "3821644937",
      "3821647288",
      "3821649079",
      "3821651434",
      "3821655060",
      "3821661000",
      "3821663568",
      "3821666331",
      "3821669040",
    ],
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

/* how many Map previews at most a Campaign's picture lays side by side: its first Maps',
   in its order, on its banners and its share card; a Campaign of fewer Maps has a panel
   for each */
export const CAMPAIGN_MAX_PICTURES = 5;

const PREFIX = "OverallCampaign_";

/* a Campaign's standings, as a board name */
export const campaignBoard = (c: Campaign) => PREFIX + c.slug;

export const campaignOf = (slug: string) => CAMPAIGNS.find((c) => c.slug === slug) ?? null;

export const campaignOfBoard = (name: string) =>
  name.startsWith(PREFIX) ? campaignOf(name.slice(PREFIX.length)) : null;

/* what an Overall board adds up, one of them, as its copy names it: a Campaign's Maps, or a
   season's Tracks */
export const unitOf = (board: string) => (campaignOfBoard(board) ? "map" : "track");

/* the Campaign a Map is in and its place there (0-based), or null; a Map is in one at most */
export function campaignOfMap(pfid: string): { campaign: Campaign; index: number } | null {
  for (const campaign of CAMPAIGNS) {
    const index = campaign.maps.indexOf(pfid);
    if (index >= 0) return { campaign, index };
  }
  return null;
}

/* a Map's number in its Campaign, as a Track's is in its season: its place in the maker's
   order, counting from 1 */
export const mapNumber = (c: Campaign, pfid: string) => c.maps.indexOf(pfid) + 1;

/* that number as the rail shows it, two digits */
export const mapNo = (c: Campaign, pfid: string) => String(mapNumber(c, pfid)).padStart(2, "0");

/* a Map's name inside its Campaign: its title after the Campaign's name, when it starts
   with it ("Solar Trials Mercury" is Mercury), else the whole title; or null when that is
   only its number ("Miniblack 01", "AJC1"), which its label already gives. When what is
   left starts with a number that isn't its place ("Ninja0", "AJ26"), it stays whole, so
   the label doesn't read "01 0" */
export function mapName(c: Campaign, pfid: string, title: string): string | null {
  const prefix = c.title.toLowerCase();
  if (!title.toLowerCase().startsWith(prefix)) return title;
  const name = title.slice(prefix.length).trim() || title;
  const lead = /^\d+/.exec(name);
  if (lead === null) return name;
  if (Number(lead[0]) !== mapNumber(c, pfid)) return title;
  return lead[0] === name ? null : name;
}

/* a Map's label inside its Campaign, wherever the Campaign's frame names it (the rail's
   card, the tally, the page's title): its number, then its name when it has one */
export function mapLabel(c: Campaign, pfid: string, title: string) {
  const name = mapName(c, pfid, title);
  return name === null ? mapNo(c, pfid) : `${mapNo(c, pfid)} ${name}`;
}
