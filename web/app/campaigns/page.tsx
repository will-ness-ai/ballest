// /campaigns: every Campaign with a Map the Workshop lists, as a banner each in a grid,
// most players first (getCampaigns). The homepage's Campaigns carousel's See all opens it.
// Prerendered; it lights the Workshop tab.
import type { Metadata } from "next";

import { BackLink } from "../../components/BackLink";
import { Shell } from "../../components/Shell";
import { CampaignBanner } from "../../components/campaign/CampaignBanner";
import { getCampaigns } from "../../db/data";
import { homeHref } from "../../lib/routes";

export const metadata: Metadata = {
  title: "Campaigns",
  description:
    "Player-made Campaigns of Ballest of Them All Workshop maps, each ranked by points for every map the way the Circuit ranks a season.",
};

export default async function Page() {
  const campaigns = await getCampaigns();
  return (
    <Shell view="maps">
      <section className="ws" id="ws">
        <BackLink href={homeHref()} label="Workshop" />
        <div className="call-h">
          <h1 className="ws-h1">Campaigns</h1>
          <p>
            Runs of Workshop maps their makers built to be played in order. Each one scores like a
            Circuit season: points for your place on every map, added up.
          </p>
        </div>
        {campaigns.length ? (
          <div className="call">
            {campaigns.map((k) => (
              <CampaignBanner key={k.c.slug} k={k} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <b>No Campaign has a map on the Workshop yet.</b>
          </div>
        )}
      </section>
    </Shell>
  );
}
