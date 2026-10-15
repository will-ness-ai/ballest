// /: the Workshop homepage, a carousel of five picks and the shelves, with a search over
// every Map with a time (/api/maps). The picks and each shelf's Maps are chosen here; the
// browser counts what reads the clock (components/workshop/WorkshopHome).
import { Remember } from "../components/BackLink";
import { Shell } from "../components/Shell";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getMapCards, getSite } from "../db/data";
import {
  CampaignBand,
  CampaignMenu,
  CampaignShelf,
  CampaignTable,
  campaignCards,
} from "../components/campaign/HomeEntry";
import { Picker } from "../components/campaign/Picker";
import { CAMPAIGNS } from "../lib/campaigns";
import { homeHref } from "../lib/routes";
import { SHELVES, picks, shelfMaps } from "../lib/workshop";

export default async function Page() {
  const [{ asOf }, maps, cards] = await Promise.all([getSite(), getMapCards(), campaignCards()]);
  return (
    <Shell view="workshop">
      <section className="ws" id="ws">
        <WorkshopHome
          picks={picks(maps)}
          shelves={SHELVES.map((d) => shelfMaps(maps, d))}
          asOf={asOf}
          proto={{
            head: <CampaignMenu cards={cards} />,
            top: <CampaignTable cards={cards} />,
            mid: (
              <>
                <CampaignShelf cards={cards} />
                <CampaignBand cards={cards} />
              </>
            ),
          }}
        />
        <Picker
          variants={[
            { key: "A", name: "Shelf", note: "A Campaigns shelf under the carousel: cards with four of its Maps' pictures and the leader." },
            { key: "B", name: "Banners", note: "Wide banners under the carousel, each Campaign's pictures behind its name and leader." },
            { key: "C", name: "Badges", note: "No section: a Map card in a Campaign carries its badge (Solar Trials 3/9), on its picture." },
            { key: "D", name: "Head menu", note: "A Campaigns menu beside All maps in the head; nothing else changes." },
            { key: "E", name: "Table on top", note: "A compact Campaigns list above the carousel." },
          ]}
          states={[["Solar Trials page", "/campaign/" + CAMPAIGNS[0].slug]]}
        />
      </section>
      <Remember trail="maps" href={homeHref()} />
    </Shell>
  );
}
