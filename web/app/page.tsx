// /: the Workshop homepage, a carousel of five picks and the shelves, with a search over
// every Map with a time (/api/maps). The picks and each shelf's Maps are chosen here; the
// browser counts what reads the clock (components/workshop/WorkshopHome).
import { Remember } from "../components/BackLink";
import { Shell } from "../components/Shell";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { getMapCards, getSite } from "../db/data";
import { homeHref } from "../lib/routes";
import { SHELVES, picks, shelfMaps } from "../lib/workshop";

export default async function Page() {
  const [{ asOf }, maps] = await Promise.all([getSite(), getMapCards()]);
  return (
    <Shell view="workshop">
      <section className="ws" id="ws">
        <WorkshopHome
          picks={picks(maps)}
          shelves={SHELVES.map((d) => shelfMaps(maps, d))}
          asOf={asOf}
        />
      </section>
      <Remember trail="maps" href={homeHref()} />
    </Shell>
  );
}
