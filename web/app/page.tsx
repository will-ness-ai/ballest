// /: the Workshop homepage, a carousel of five picks, the Campaigns' carousel and the
// shelves, with a search over every Map with a time (/api/maps). The picks and each
// shelf's Maps are chosen here; the browser counts what reads the clock
// (components/workshop/WorkshopHome).
import type { Metadata } from "next";

import { PageHead } from "../components/PageHead";
import { Shell } from "../components/Shell";
import { Remember } from "../components/Trail";
import { CampaignBanner } from "../components/campaign/CampaignBanner";
import { CampaignCarousel } from "../components/campaign/CampaignCarousel";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getCampaigns, getMapCards, getSite } from "../db/data";
import { SITE_ORIGIN, homeHref } from "../lib/routes";
import { SITE_NAME, SITE_TITLE } from "../lib/rules";
import { SHELVES, picks, shelfMaps } from "../lib/workshop";

/* The homepage is the one search result for the site's name, so its title says what the
   site is: the site's name, then the game whose boards it mirrors. */
export const metadata: Metadata = {
  title: {
    absolute: SITE_TITLE + ": Ballest of Them All Workshop, Circuit and Daily leaderboards",
  },
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
  const [{ asOf }, maps, campaigns] = await Promise.all([getSite(), getMapCards(), getCampaigns()]);
  return (
    <Shell view="workshop">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WEBSITE }} />
      <PageHead path={homeHref()} title="Featured Maps" />
      <section className="ws" id="ws">
        <WorkshopHome
          picks={picks(maps)}
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
