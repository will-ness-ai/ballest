// /: the Workshop homepage, a carousel of five picks and the shelves, with a search over
// every Map with a time (/api/maps). The picks and each shelf's Maps are chosen here; the
// browser counts what reads the clock (components/workshop/WorkshopHome).
import { Shell } from "../components/Shell";
import { WorkshopHome } from "../components/workshop/WorkshopHome";
import { workshopCards } from "../components/workshop/data";
import { RememberList } from "../components/workshop/session";
import { homeHref } from "../lib/routes";
import { SHELVES, picks, shelfMaps } from "../lib/workshop";

export default async function Page() {
  const { maps, asOf } = await workshopCards();
  return (
    <Shell view="workshop">
      <section className="ws" id="ws">
        <WorkshopHome
          picks={picks(maps)}
          shelves={SHELVES.map((d) => shelfMaps(maps, d))}
          asOf={asOf}
        />
      </section>
      <RememberList path={homeHref()} />
    </Shell>
  );
}
