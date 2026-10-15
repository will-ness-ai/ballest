// PROTOTYPE (grill-design): /campaigns, every curated Campaign, most players first. Never
// merged. The homepage carousel's See all opens it.
import type { Metadata } from "next";
import { Suspense } from "react";

import { BackLink } from "../../components/BackLink";
import { Shell } from "../../components/Shell";
import { CampaignBanner } from "../../components/campaign/CampaignCarousel";
import { campaignCards } from "../../components/campaign/HomeEntry";

export const metadata: Metadata = {
  title: "Campaigns",
  description:
    "Player-made Campaigns of Ballest of Them All Workshop maps, each with its own points leaderboard.",
};

async function All() {
  const cards = await campaignCards();
  return (
    <>
      <div className="call-h">
        <h1>Campaigns</h1>
        <p>
          Runs of Workshop maps their makers built to be played in order. Each one scores like a
          Circuit season: points for your place on every map, added up.
        </p>
      </div>
      <div className="call">
        {cards.map((k) => (
          <CampaignBanner key={k.c.slug} k={k} />
        ))}
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Shell view="maps">
      <section className="ws" id="ws">
        <BackLink href="/" label="Workshop" />
        <Suspense>
          <All />
        </Suspense>
      </section>
    </Shell>
  );
}
