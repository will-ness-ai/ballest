// /map/<pfid>[/<steam_id>]: a Workshop Map's page (components/workshop/MapView). The five
// newest Maps are prerendered so the route has a static shell; any other is served from
// it, then cached whole.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { MapView } from "../../../../components/workshop/MapView";
import { getWorkshop } from "../../../../db/data";
import { timed } from "../../../../lib/workshop";

/* spelled out rather than Next's generated PageProps, which only exists after a build */
interface Props {
  params: Promise<{ pfid: string; focus?: Array<string> }>;
}

export async function generateStaticParams() {
  return timed(await getWorkshop())
    .slice(0, 5)
    .map((m) => ({ pfid: m.pfid, focus: [] }));
}

const mapOf = async (pfid: string) => (await getWorkshop()).find((m) => m.pfid === pfid);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = await mapOf((await params).pfid);
  if (!m) return {};
  return {
    title: m.title,
    description: `The leaderboard of ${m.title}, a Ballest of Them All Workshop map by ${m.creator}, read straight from Steam.`,
  };
}

async function MapPage({ params }: Props) {
  const { pfid, focus = [] } = await params;
  return <MapView m={await mapOf(pfid)} focus={focus.length > 1 ? "-" : (focus[0] ?? null)} />;
}

export default function Page({ params }: Props) {
  return (
    <Shell view="map">
      <Suspense fallback={<BoardSkeleton />}>
        <MapPage params={params} />
      </Suspense>
    </Shell>
  );
}
