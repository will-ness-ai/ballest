// /: the Workshop homepage, a carousel of five picks, the Campaigns' carousel and the
// shelves, with a search over every Map with a time (/api/maps). The picks and each
// shelf's Maps are chosen here; the browser counts what reads the clock
// (components/workshop/WorkshopHome).
import { Remember } from "../components/BackLink";
import { Shell } from "../components/Shell";
import { CampaignBanner } from "../components/campaign/CampaignBanner";
import { CampaignCarousel } from "../components/campaign/CampaignCarousel";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getCampaigns, getMapCards, getSite } from "../db/data";
import { homeHref } from "../lib/routes";
import { SHELVES, picks, shelfMaps } from "../lib/workshop";

export default async function Page() {
  const [{ asOf }, maps, campaigns] = await Promise.all([getSite(), getMapCards(), getCampaigns()]);
  return (
    <Shell view="workshop">
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
      <Remember trail="maps" href={homeHref()} />
    </Shell>
  );
}
