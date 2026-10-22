// PROTOTYPE: grill-design for the site's navigation and search (claude/prototype-nav).
// Never merged. GET /api/proto-search?q=: everything the global search can find, grouped.
import {
  getCampaigns,
  getDailies,
  getMapCards,
  getPrefabCards,
  getSite,
  searchPlayers,
} from "../../../db/data";
import { TRACKS } from "../../../lib/circuit";
import { searchMaps } from "../../../lib/workshop";

const has = (s: string, t: string) => s.toLowerCase().includes(t);
const starts = (s: string, t: string) => s.toLowerCase().startsWith(t);

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  if (!q) return Response.json(null);
  const [cards, campaigns, site, prefabs, dailies, players] = await Promise.all([
    getMapCards(),
    getCampaigns(),
    getSite(),
    getPrefabCards().catch(() => []),
    getDailies().catch(() => []),
    searchPlayers(q, ""),
  ]);

  /* makers: everyone whose Maps match by creator, with how many they made */
  const made = new Map<string, { id: string | null; name: string; maps: number; runs: number }>();
  for (const m of cards) {
    const k = m.cid ?? m.creator;
    const e = made.get(k) ?? { id: m.cid, name: m.creator, maps: 0, runs: 0 };
    e.maps++;
    e.runs += m.entryCount;
    made.set(k, e);
  }
  const people = new Map<
    string,
    { id: string; name: string; avatar: string | null; made: number; plays: boolean }
  >();
  for (const p of players)
    people.set(p.steamId, {
      id: p.steamId,
      name: p.persona,
      avatar: p.avatar,
      made: 0,
      plays: true,
    });
  for (const m of made.values()) {
    if (!m.id || !has(m.name, q)) continue;
    const e = people.get(m.id);
    if (e) e.made = m.maps;
    else people.set(m.id, { id: m.id, name: m.name, avatar: null, made: m.maps, plays: false });
  }
  const peopleList = [...people.values()]
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase() === q) - Number(a.name.toLowerCase() === q) ||
        Number(starts(b.name, q)) - Number(starts(a.name, q)) ||
        b.made - a.made,
    )
    .slice(0, 4);

  const mapHits = searchMaps(
    cards.filter((m) => has(m.title, q)),
    q,
  );
  const maps = mapHits.slice(0, 5).map((m) => ({
    pfid: m.pfid,
    title: m.title,
    creator: m.creator,
    preview: m.preview,
    runs: m.entryCount,
    record: m.top3[0] ?? null,
  }));

  const camps = campaigns
    .filter((c) => has(c.c.title, q) || has(c.c.creator, q))
    .slice(0, 4)
    .map((c) => ({
      slug: c.c.slug,
      title: c.c.title,
      creator: c.c.creator,
      maps: c.c.maps.length,
      players: c.players,
      preview: c.previews.find(Boolean) ?? null,
    }));

  const tracks = site.boards
    .filter((b) => has(b.display, q) || has(b.group + " " + b.display, q) || has(b.name, q))
    .slice(0, 4)
    .map((b) => ({
      name: b.name,
      display: b.display,
      group: b.group,
      players: b.entryCount,
      img: TRACKS[b.name]?.img ?? null,
    }));

  const pf = prefabs
    .filter((p) => has(p.name, q) || p.tags.some((t) => has(t, q)))
    .slice(0, 4)
    .map((p) => ({ slug: p.slug, name: p.name, by: p.uploader.name, pieces: p.pieces }));

  const days = dailies
    .filter((d) => has(d.title, q) || d.date.includes(q))
    .slice(0, 3)
    .map((d) => ({ date: d.date, title: d.title, preview: d.preview, players: d.entryCount }));

  return Response.json({
    q,
    people: peopleList,
    maps,
    mapTotal: mapHits.length,
    campaigns: camps,
    tracks,
    prefabs: pf,
    dailies: days,
  });
}
