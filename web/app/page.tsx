// /: the Workshop homepage, Trending this week, the Campaigns' carousel and the
// shelves, with a search over every Map with a time (/api/maps). The chart's and each
// shelf's Maps are chosen here; the browser counts what reads the clock
// (components/workshop/WorkshopHome).
import type { Metadata } from "next";

import { PageHead } from "../components/PageHead";
import { Shell } from "../components/Shell";
import { Remember } from "../components/Trail";
import { CampaignBanner } from "../components/campaign/CampaignBanner";
import { CampaignCarousel } from "../components/campaign/CampaignCarousel";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getCampaigns, getMapCards, getSite, getTrending } from "../db/data";
import { SITE_ORIGIN, homeHref } from "../lib/routes";
import { SITE_NAME, SITE_TITLE, pageTitle } from "../lib/rules";
import { SHELVES, shelfMaps } from "../lib/workshop";

/* The homepage is the result for searches of the game with "leaderboard" or "records", so its
   title leads with those words, as every other page's does with its own, and ends with the
   site's name. */
export const metadata: Metadata = {
  title: { absolute: pageTitle("Ballest of Them All Leaderboards & Records") },
  alternates: { canonical: homeHref() },
};

/* the site's name for search results (schema.org WebSite), which Google reads from the
   homepage alone */
const WEBSITE = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_TITLE,
  alternateName: ["Ballest Records", SITE_NAME],
  url: SITE_ORIGIN + homeHref(),
});

export default async function Page() {
  const [{ asOf }, maps, trend, campaigns] = await Promise.all([
    getSite(),
    getMapCards(),
    getTrending(),
    getCampaigns(),
  ]);
  return (
    <Shell view="workshop">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WEBSITE }} />
      <PageHead path={homeHref()} title="Featured Maps" />
      <section className="ws" id="ws">
        <WorkshopHome
          trend={trend}
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
      <Remember trail="maps" href={homeHref()} label="Featured" />
    </Shell>
  );
}
