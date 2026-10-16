// The switch between Campaigns, the Circuit's season switch over again: on a desktop, a row
// of sub-tabs under the main tabs; on a phone, a chip beside the board button whose menu
// gives each Campaign's Maps and players. Each Campaign opens its Overall board. The list
// is getCampaigns', most players first.
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

/* each Campaign's link, lit on the Campaign on screen */
const link = (c: Campaign, on: Campaign) => ({
  href: campaignHref(c.slug),
  "aria-current": c.slug === on.slug,
});

export function CampaignTabs({ list, on }: Props) {
  return (
    <nav className="seasontabs" aria-label="Campaign">
      {list.map(({ c }) => (
        <Link {...link(c, on)} key={c.slug}>
          {c.title}
        </Link>
      ))}
    </nav>
  );
}

/* `board` names the menu, since a board page left behind can stay in the document */
export function CampaignChip({ list, on, board }: Props & { board: string }) {
  return (
    <SeasonMenu id={`campaigns-${board}`} label={on.title} kind="Campaign">
      {list.map(({ c, maps, players }) => (
        <Link {...link(c, on)} key={c.slug}>
          <b>{c.title}</b>
          <small>
            {plural(maps, "Map", "Maps")} · {plural(players, "player", "players")}
          </small>
        </Link>
      ))}
    </SeasonMenu>
  );
}
