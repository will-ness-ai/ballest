// One Campaign as a banner: its Maps' pictures at full strength, with its name, maker,
// counts and leader over a fade on the left. The homepage's carousel and /campaigns list
// these, most players first (getCampaigns).
import Link from "next/link";

import { CampaignPics } from "./CampaignPics";
import { Marble } from "../Marble";
import type { ListedCampaign } from "../../db/data";
import { campaignHref } from "../../lib/routes";
import { fmtN, personaOf, plural } from "../../lib/rules";

export function CampaignBanner({ k }: { k: ListedCampaign }) {
  return (
    <Link className="cban" href={campaignHref(k.c.slug)}>
      <CampaignPics previews={k.previews} />
      <span className="cban-in">
        <span className="eyebrow">
          Campaign · {plural(k.maps, "map", "maps")} · {plural(k.players, "player", "players")}
        </span>
        <b className="cban-t">{k.c.title}</b>
        <span className="cban-by">by {k.c.creator}</span>
        {k.leader && (
          <span className="cban-lead">
            <Marble who={k.leader} still />
            <span>
              {personaOf(k.leader)} leads with {fmtN(k.leader.score)} pts
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}
