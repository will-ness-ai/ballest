// What every page's frame reads from the database, once per request: when the boards were
// read, the navigation's facts (lib/nav.ts) and the site search's jump-to links (jumpsOf in
// lib/search.ts). The header (Shell) and the page head (PageHead) both ask for it, and
// React's cache() hands the second the first one's answer rather than reading every list
// again.
import { cache } from "react";

import { getCampaigns, getDailies, getSite, hasWorkshop, type Site } from "../db/data";
import { campaignSummary } from "../lib/campaigns";
import { navCampaigns, type NavFacts } from "../lib/nav";
import { seasonsOf } from "../lib/player";
import { jumpsOf, type Hit } from "../lib/search";

export interface Frame {
  site: Site;
  facts: NavFacts;
  jumps: Array<Hit>;
}

export const frameOf = cache(async (): Promise<Frame> => {
  const [site, workshop, dailies, listed] = await Promise.all([
    getSite(),
    hasWorkshop(),
    getDailies(),
    getCampaigns(),
  ]);
  const seasons = seasonsOf(site.boards);
  const campaigns = listed.map(campaignSummary);
  return {
    site,
    facts: {
      workshop,
      daily: dailies.length > 0,
      seasons: seasons.map(({ group, overall }) => ({ group, overall })),
      campaigns: navCampaigns(campaigns),
    },
    jumps: jumpsOf({ dailies, seasons, campaigns }),
  };
});
