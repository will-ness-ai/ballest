// What the Workshop pages read: the Maps with a time as cards, and the time the data was
// read, which the ages count to until the browser's clock takes over (session.tsx).
import { getSite, getWorkshop } from "../../db/data";
import { mapCard, timed } from "../../lib/workshop";

export async function workshopCards() {
  const [site, maps] = await Promise.all([getSite(), getWorkshop()]);
  return {
    maps: timed(maps).map(mapCard),
    asOf: site.refreshedAt ? Date.parse(site.refreshedAt) : 0,
  };
}
