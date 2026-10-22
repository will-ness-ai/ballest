// /campaign/<slug>[/<pfid>|/<event>[/<steam_id>]|/podiums|/<steam_id>]: a Campaign's page
// (components/campaign/CampaignView). Every curated Campaign, its podium order and each of
// its Maps is prerendered, as the season pages are; a link to a player's row is served from
// the App Shell, then cached whole. A path proxy.ts can tell is wrong is a 404 there.
// Each names its share image: a Map inside the frame its own, any other the Campaign's.
import type { Metadata } from "next";
import { Suspense } from "react";

import { Shell } from "../../../../components/Shell";
import { BoardSkeleton } from "../../../../components/Skeleton";
import { CampaignView } from "../../../../components/campaign/CampaignView";
import { pageMetadata } from "../../../../components/metadata";
import { getCampaign } from "../../../../db/data";
import { CAMPAIGNS, eventOf, mapLabel, mapNumber } from "../../../../lib/campaigns";
import { PODIUM_SORT, campaignHref, mapHref } from "../../../../lib/routes";
import { isPfid } from "../../../../lib/rules";

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
  /* one of its Maps, or an Event's with a row after it */
  const m =
    slot.length === 1 || (slot.length === 2 && eventOf(slot[0]))
      ? maps.find((x) => x.pfid === slot[0])
      : undefined;
  /* an Event board has no page of its own, so this slot is the one to index, with the
     Campaign's card; in a Campaign of that one Map, the Campaign's page holds the same board */
  if (m && eventOf(m.pfid))
    return pageMetadata(
      {
        title: `${c.title} ${mapLabel(c, m.pfid, m.title)}`,
        canonical: c.maps.length === 1 ? campaignHref(c.slug) : campaignHref(c.slug, m.pfid),
        description: `The leaderboard of ${m.title}, an event board of Ballest of Them All, read from Steam after the event ended.`,
      },
      {
        kind: "campaign",
        id: c.slug,
        alt: `${c.title}, a Campaign by ${c.creator}, and its leader.`,
      },
    );
  if (m) {
    const title = `${c.title} ${mapLabel(c, m.pfid, m.title)}`;
    /* the same board as the Map's own page, which is the one to index */
    return pageMetadata(
      {
        title,
        canonical: mapHref(m.pfid),
        description: `The leaderboard of ${m.title}, map ${String(mapNumber(c, m.pfid))} of the ${c.title} Campaign by ${c.creator}, read straight from Steam.`,
      },
      {
        kind: "map",
        id: m.pfid,
        alt: `${m.title}, a Workshop map by ${m.creator}, and its record.`,
      },
    );
  }
  return pageMetadata(
    {
      title: c.title,
      canonical: campaignHref(c.slug),
      description: `${c.title}, a Ballest of Them All Campaign${c.maps.every(isPfid) ? " of Workshop maps" : ""} by ${c.creator}, ranked by points for every map the way the Circuit ranks a season.`,
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
  return (
    <CampaignView
      slug={slug}
      slot={slot.length > 2 ? "-" : (slot[0] ?? null)}
      row={slot[1] ?? null}
    />
  );
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
