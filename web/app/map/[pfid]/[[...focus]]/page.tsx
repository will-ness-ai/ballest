// /map/<pfid>[/<steam_id>]: a Workshop Map's page (components/workshop/MapView). The five
// newest Maps are prerendered so the route has a static shell; any other is served from
// it, then cached whole.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { MapView } from "../../../../components/workshop/MapView";
import { getMap, getWorkshop } from "../../../../db/data";
import { pageMetadata } from "../../../../components/metadata";
import { mapHref } from "../../../../lib/routes";
import { timed } from "../../../../lib/workshop";

interface Props {
  params: Promise<{ pfid: string; focus?: Array<string> }>;
}

export async function generateStaticParams() {
  return timed(await getWorkshop())
    .slice(0, 5)
    .map((m) => ({ pfid: m.pfid, focus: [] }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = await getMap((await params).pfid);
  /* a Map that has left the Workshop is sent home, a soft 404 kept out of results */
  if (!m) return { robots: { index: false } };
  const timed = m.top3.length > 0;
  const meta = await pageMetadata(
    {
      title: m.title,
      description: `The leaderboard of ${m.title}, a Ballest of Them All Workshop map by ${m.creator}, read straight from Steam.`,
      canonical: mapHref(m.pfid),
    },
    {
      kind: "map",
      id: m.pfid,
      alt: `${m.title}, a Workshop map by ${m.creator}${timed ? ", and its record" : ""}.`,
    },
  );
  /* a Map nobody has a time on yet has a page (spec #259), kept out of results like the sitemap */
  return timed ? meta : { ...meta, robots: { index: false } };
}

async function MapPage({ params }: Props) {
  const { pfid, focus = [] } = await params;
  return (
    <MapView
      m={(await getMap(pfid)) ?? undefined}
      focus={focus.length > 1 ? "-" : (focus[0] ?? null)}
    />
  );
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
