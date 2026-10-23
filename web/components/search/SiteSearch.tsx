// The site search in the header's bar (SearchBar), with the jump-to links an empty field offers
// (jumpsOf in lib/search.ts) read from the cached lists every page's frame already reads. You's
// card goes in with it, as `you`, so a phone keeps the search button beside it.
import type { ReactNode } from "react";

import { SearchBar } from "./SearchBar";
import { getCampaigns, getDailies, getSite } from "../../db/data";
import { seasonsOf } from "../../lib/player";
import { jumpsOf } from "../../lib/search";

export async function SiteSearch({ you }: { you: ReactNode }) {
  const [site, dailies, campaigns] = await Promise.all([getSite(), getDailies(), getCampaigns()]);
  const jumps = jumpsOf({
    dailies,
    seasons: seasonsOf(site.boards),
    campaigns: campaigns.map(({ c, players, previews }) => ({
      slug: c.slug,
      title: c.title,
      players,
      preview: previews.find(Boolean) ?? null,
    })),
  });
  return <SearchBar jumps={jumps} you={you} />;
}
