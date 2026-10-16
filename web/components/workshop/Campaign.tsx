// How a Map in a Campaign says so outside the Campaign's own page: the strip along the
// bottom of its card's picture, and the Part of box on its Map page. Its number is its place
// in the curated list, out of the Campaign's Map count (lib/campaigns.ts).
import Link from "next/link";

import { campaignOfMap, mapNumber } from "../../lib/campaigns";
import { campaignHref } from "../../lib/routes";

/* inside a card's picture: the Campaign's name, then "n / N" */
export function CampaignStrip({ pfid }: { pfid: string }) {
  const at = campaignOfMap(pfid);
  if (!at) return null;
  return (
    <span className="cb-strip">
      <span>{at.campaign.title}</span>
      <span>
        {mapNumber(at.campaign, pfid)} / {at.campaign.maps.length}
      </span>
    </span>
  );
}

/* on the Map page: leads to the Map inside its Campaign's frame */
export function PartOf({ pfid }: { pfid: string }) {
  const at = campaignOfMap(pfid);
  if (!at) return null;
  const c = at.campaign;
  return (
    <Link className="mp-partof" href={campaignHref(c.slug, pfid)}>
      <span className="eyebrow">Campaign</span>
      <b>{c.title}</b>
      <span>
        Map {mapNumber(c, pfid)} of {c.maps.length} &rarr;
      </span>
    </Link>
  );
}
