// The switch between Campaigns: a chip whose menu gives each Campaign's Maps and players, at
// the head of the rail on a desktop and beside the board button on a phone. Unlike the
// Circuit's seasons it is never a row of tabs, since the list keeps growing. Each Campaign
// opens its Overall board. The list is getCampaigns', most players first.
import Link from "next/link";

import { SeasonMenu } from "../board/SeasonMenu";
import type { ListedCampaign } from "../../db/data";
import type { Campaign } from "../../lib/campaigns";
import { campaignHref } from "../../lib/routes";
import { plural } from "../../lib/rules";

interface Props {
  list: ReadonlyArray<ListedCampaign>;
  on: Campaign;
}

/* `board` names the menu, since a board page left behind can stay in the document */
export function CampaignChip({ list, on, board }: Props & { board: string }) {
  return (
    <SeasonMenu id={`campaigns-${board}`} label={on.title} kind="Campaign">
      {list.map(({ c, players }) => (
        <Link href={campaignHref(c.slug)} aria-current={c.slug === on.slug} key={c.slug}>
          <b>{c.title}</b>
          <small>
            {plural(c.maps.length, "Map", "Maps")} · {plural(players, "player", "players")}
          </small>
        </Link>
      ))}
    </SeasonMenu>
  );
}
