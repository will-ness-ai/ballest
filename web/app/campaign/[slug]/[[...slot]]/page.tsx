// /campaign/<slug>[/<pfid>|/podiums|/<steam_id>]: a Campaign's page
// (components/campaign/CampaignView). Every curated Campaign, its podium order and each of
// its Maps is prerendered, as the season pages are; a link to a player's row is served from
// the App Shell, then cached whole. A path proxy.ts can tell is wrong is a 404 there.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { CampaignView } from "../../../../components/campaign/CampaignView";
import { CAMPAIGNS, campaignOf } from "../../../../lib/campaigns";
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
  const c = campaignOf((await params).slug);
  if (!c) return {};
  return {
    title: c.title,
    description: `${c.title}, a Ballest of Them All Campaign of Workshop maps by ${c.creator}, ranked by points for every map the way the Circuit ranks a season.`,
  };
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
