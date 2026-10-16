// The Campaigns shelf at the top of a player's Workshop tab: a card for each Campaign they
// hold a place in, most players first, with its pictures and name, their place of all its
// players (in its medal colour on a podium), their points, how many of its Maps they have
// finished out of all it has (a Map gone from the Workshop counts, as it is numbered), and
// a bar of it. A card opens the Campaign's board at their row. A player in no Campaign has
// no shelf.
import Link from "next/link";

import { Shelf } from "./Shelf";
import { CampaignPics } from "../campaign/CampaignPics";
import type { PlayerCampaign } from "../../db/data";
import { campaignBoard } from "../../lib/campaigns";
import { boardHref } from "../../lib/routes";
import { fmtN, ord } from "../../lib/rules";

export function CampaignCards({
  campaigns,
  id,
}: {
  campaigns: ReadonlyArray<PlayerCampaign>;
  id: string;
}) {
  if (!campaigns.length) return null;
  return (
    <Shelf title="Campaigns" className="pcamps">
      {campaigns.map((k) => (
        <Link
          key={k.c.slug}
          className="pcamp"
          href={boardHref(campaignBoard(k.c), id)}
          data-m={k.rank <= 3 ? k.rank : 0}
        >
          <span className="pc-pic">
            <CampaignPics previews={k.previews} max={4} />
            <b className="pc-t">{k.c.title}</b>
          </span>{" "}
          <span className="pc-r">
            <b>{ord(k.rank)}</b> <small>of {fmtN(k.players)}</small>
          </span>{" "}
          <span className="pc-s">
            {`${fmtN(k.score)} pts · ${String(k.finished)}/${String(k.c.maps.length)} maps`}
          </span>{" "}
          <span className="pc-bar" aria-hidden="true">
            <i style={{ width: ((k.finished / k.c.maps.length) * 100).toFixed(0) + "%" }}></i>
          </span>
        </Link>
      ))}
    </Shelf>
  );
}
