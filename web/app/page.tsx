// /: the Workshop homepage, a carousel of five picks and the shelves, with a search over
// every Map with a time (/api/maps). The picks and each shelf's Maps are chosen here; the
// browser counts what reads the clock (components/workshop/WorkshopHome).
import { Remember } from "../components/BackLink";
import { Shell } from "../components/Shell";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getMapCards, getSite } from "../db/data";
import { campaignCards } from "../components/campaign/HomeEntry";
import { CampaignCarousel } from "../components/campaign/CampaignCarousel";
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
          proto={{ head: null, top: null, mid: <CampaignCarousel cards={cards} /> }}
        />
        <Picker
          variants={[
            { key: "A", name: "Glass tag", note: "A dark glass tag on the picture's corner: the Campaign and the Map's number." },
            { key: "B", name: "Picture strip", note: "A strip across the bottom of the picture: Campaign name left, 3 / 9 right." },
            { key: "C", name: "Text line", note: "Nothing on the picture: a line under the title, a small mark, the Campaign, map 3 of 9." },
            { key: "D", name: "Number chip", note: "A small round chip with the Map's number in its Campaign, the name on the card's by-line." },
            { key: "E", name: "Progress dots", note: "A row of dots along the picture's bottom edge, one per Map, this one lit, with the Campaign name." },
          ]}
          states={[
            ["All maps", "/maps"],
            ["Earth's Map page", "/map/3805391903"],
            ["Solar Trials", "/campaign/" + CAMPAIGNS[0].slug],
          ]}
        />
      </section>
      <Remember trail="maps" href={homeHref()} />
    </Shell>
  );
}
