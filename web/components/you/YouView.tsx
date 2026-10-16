// Where you stand (/you): a card per Workshop standing, four across on a desktop and stacked on
// a phone (verdicts 1 and 2 of spec #221). The lists' top 3 are the same for everyone, so they
// are read here, cached, and drawn into the page; You's rows come from the browser
// (Ladders), since the page is cached for everyone.
import { Ladders } from "./Ladders";
import { getSite, getWorkshopStandings } from "../../db/data";
import { laddersOf } from "../../lib/ladder";
import { youBaseline } from "../../lib/workshop-standings";

export async function YouView() {
  const site = await getSite();
  /* the baseline as of the latest Refresh: the browser checks it against its own clock
     before it shows a gain or a move from it */
  const s = await getWorkshopStandings(youBaseline(site.asOf));
  return <Ladders tops={laddersOf(s, null)} />;
}
