// /: the Workshop homepage, Trending this week, the Campaigns' carousel and the
// shelves, with a search over every Map with a time (/api/maps). The chart's and each
// shelf's Maps are chosen here; the browser counts what reads the clock
// (components/workshop/WorkshopHome).
import type { Metadata } from "next";

import { Remember } from "../components/BackLink";
import { Shell } from "../components/Shell";
import { CampaignBanner } from "../components/campaign/CampaignBanner";
import { CampaignCarousel } from "../components/campaign/CampaignCarousel";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getCampaigns, getMapCards, getSite } from "../db/data";
import { SITE_ORIGIN, homeHref } from "../lib/routes";
import { SITE_NAME, SITE_TITLE } from "../lib/rules";
import { SHELVES, shelfMaps, trending } from "../lib/workshop";

/* The homepage is the one search result for the site's name, so its title says what the
   site is; the tab keeps the game's name first. */
export const metadata: Metadata = {
  title: { absolute: SITE_TITLE + " Records: Workshop, Circuit and Daily leaderboards" },
  alternates: { canonical: homeHref() },
};

/* the site's name for search results (schema.org WebSite), which Google reads from the
   homepage alone */
const WEBSITE = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Ballest Records",
  alternateName: SITE_NAME,
  url: SITE_ORIGIN + homeHref(),
});

export default async function Page() {
  const [{ asOf }, maps, campaigns] = await Promise.all([getSite(), getMapCards(), getCampaigns()]);
  return (
    <Shell view="workshop">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WEBSITE }} />
      <section className="ws" id="ws">
        <WorkshopHome
          trend={trending(maps)}
          campaigns={
            <CampaignCarousel>
              {campaigns.map((k) => (
                <CampaignBanner key={k.c.slug} k={k} />
              ))}
            </CampaignCarousel>
          }
          shelves={SHELVES.map((d) => shelfMaps(maps, d))}
          asOf={asOf}
        />
      </section>
      <Remember trail="maps" href={homeHref()} />
    </Shell>
  );
}
