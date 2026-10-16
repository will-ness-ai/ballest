// PROTOTYPE (grill-design): /campaign/<slug>[/<pfid>|/podiums|/<steam id>]. Never merged.
import type { Metadata } from "next";
import { Suspense } from "react";

import { shareMetadata } from "../../../../components/share/metadata";

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
  return shareMetadata(
    {
      title: c.title,
      description: `${c.title}, a Campaign by ${c.creator}: points for every map, added up.`,
    },
    { kind: "campaign", id: c.slug, alt: c.title + " Campaign" },
  );
}

async function Body({ params }: Props) {
  const { slug, slot = [] } = await params;
  return <CampaignView slug={slug} slot={slot.length > 1 ? "-" : (slot[0] ?? null)} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="board">
      <Suspense fallback={<BoardSkeleton />}>
        <Body params={params} />
      </Suspense>
    </Shell>
  );
}
