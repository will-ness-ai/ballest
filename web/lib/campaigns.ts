// PROTOTYPE (grill-design, claude/prototype-campaigns): the curated Campaigns, never merged.
export interface Campaign {
  slug: string;
  title: string;
  creator: string;
  cid: string;
  /* the Maps, in the creator's order, by Workshop ID */
  maps: Array<string>;
}

export const CAMPAIGNS: Array<Campaign> = [
  {
    slug: "solar-trials",
    title: "Solar Trials",
    creator: "habibal223366977",
    cid: "76561199154600151",
    maps: ["3805399883", "3805394429", "3805391903", "3805383837", "3805286915", "3805279771", "3805274484", "3805269048", "3805413302"],
  },
  {
    slug: "velocity-trials",
    title: "Velocity Trials",
    creator: "habibal223366977",
    cid: "76561199154600151",
    maps: ["3803908791", "3803910868", "3803919944", "3803929459", "3803937353"],
  },
  {
    slug: "tilted-campaign",
    title: "Tilted Campaign",
    creator: "Helvetica Standard",
    cid: "76561198329712885",
    maps: ["3818800453", "3818796364", "3818793772", "3818792773"],
  },
  {
    slug: "miniblack",
    title: "Miniblack",
    creator: "Raincake",
    cid: "76561198324121617",
    maps: ["3811078255", "3811099010", "3811155056", "3812300011", "3812315670", "3812537702", "3813953489", "3814363275", "3814672448", "3815119058"],
  },
  {
    slug: "ajc",
    title: "AJC",
    creator: "Action Jackson",
    cid: "76561198008697957",
    maps: ["3646349274", "3737890903", "3744752972", "3762695115", "3788055152"],
  },
];

export const campaignOf = (slug: string) => CAMPAIGNS.find((c) => c.slug === slug) ?? null;
export const campaignHref = (slug: string) => "/campaign/" + slug;
