// /campaign/<slug>[/<pfid>|/podiums|/<steam_id>]: a Campaign's page
// (components/campaign/CampaignView). Every curated Campaign, its podium order and each of
// its Maps is prerendered, as the season pages are; a link to a player's row is served from
// the App Shell, then cached whole. A path proxy.ts can tell is wrong is a 404 there.
// Each names its share image: a Map inside the frame its own, any other the Campaign's.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { CampaignView } from "../../../../components/campaign/CampaignView";
import { shareMetadata } from "../../../../components/share/metadata";
import { getCampaign } from "../../../../db/data";
import { CAMPAIGNS, mapLabel, mapNumber } from "../../../../lib/campaigns";
import { PODIUM_SORT } from "../../../../lib/routes";

interface Props {
  params: Promise<{ slug: string; slot?: Array<string> }>;
}

export function generateStaticParams() {
  return CAMPAIGNS.flatMap((c) => [
    { slug: c.slug, slot: [] },
    { slug: c.slug, slot: [PODIUM_SORT] },
    ...c.maps.map((pfid) => ({ slug: c.slug, slot: [pfid] })),
  ]);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, slot = [] } = await params;
  /* a Campaign with no Map the Workshop lists is a 404, so it names no card */
  const data = await getCampaign(slug);
  if (!data) return {};
  const { c, maps } = data;
  const m = slot.length === 1 ? maps.find((x) => x.pfid === slot[0]) : undefined;
  if (m) {
    const title = `${c.title} ${mapLabel(c, m.pfid, m.title)}`;
    return shareMetadata(
      {
        title,
        description: `The leaderboard of ${m.title}, map ${String(mapNumber(c, m.pfid))} of the ${c.title} Campaign by ${c.creator}, read straight from Steam.`,
      },
      {
        kind: "map",
        id: m.pfid,
        alt: `${m.title}, a Workshop map by ${m.creator}, and its record.`,
      },
    );
  }
  return shareMetadata(
    {
      title: c.title,
      description: `${c.title}, a Ballest of Them All Campaign of Workshop maps by ${c.creator}, ranked by points for every map the way the Circuit ranks a season.`,
    },
    {
      kind: "campaign",
      id: c.slug,
      alt: `${c.title}, a Campaign by ${c.creator}, and its leader.`,
    },
  );
}

async function Campaign({ params }: Pick<Props, "params">) {
  const { slug, slot = [] } = await params;
  return <CampaignView slug={slug} slot={slot.length > 1 ? "-" : (slot[0] ?? null)} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="board">
      <Suspense fallback={<BoardSkeleton />}>
        <Campaign params={params} />
      </Suspense>
    </Shell>
  );
}
