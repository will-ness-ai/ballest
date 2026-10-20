// PROTOTYPE — round 2: explicit alternatives for selecting five recent Maps.
import { ageDays } from "./rules";
import { HIDDEN, type MapCard } from "./workshop";

export interface HomeActivity {
  asOf: number;
  metrics: Partial<Record<string, { day: number | null; week: number | null }>>;
}
export const DISCOVERY_POLICIES = [
  {
    key: "A",
    name: "Trending this week",
    title: "Trending new maps",
    note: "Published in the last 30 days · ranked by reported play sessions over 7 days. Popular picks may stay until activity changes.",
  },
  {
    key: "B",
    name: "Trending today",
    title: "Trending today",
    note: "Published in the last 14 days · ranked by reported play sessions over 24 hours. Faster moving, but more sensitive to small counts.",
  },
  {
    key: "C",
    name: "Popular new releases",
    title: "Popular new maps",
    note: "Published in the last 7 days · ranked by total reported play sessions since publication. Older releases leave the pool each day.",
  },
  {
    key: "D",
    name: "Newest with times",
    title: "New maps to play",
    note: "Five newest Maps with at least five players holding a time, published in the last 30 days. No popularity ranking.",
  },
  {
    key: "E",
    name: "Daily discovery",
    title: "Today's map picks",
    note: "Five picks rotate daily through up to 20 recent Maps, ordered by 7-day reported activity. All published within 30 days; these are discovery picks, not a top-five ranking.",
  },
] as const;
export type DiscoveryKey = (typeof DISCOVERY_POLICIES)[number]["key"];
export interface DiscoveryPick {
  m: MapCard;
  recent: number | null;
  period: "24h" | "7d" | "since publication";
  fallback: boolean;
}

export function discoveryPicks(
  maps: ReadonlyArray<MapCard>,
  activity: HomeActivity,
  key: DiscoveryKey,
  now: number,
): Array<DiscoveryPick> {
  const days = key === "B" ? 14 : key === "C" ? 7 : 30;
  const eligible = maps.filter(
    (m) =>
      !HIDDEN[m.pfid] &&
      m.top3.length > 0 &&
      ageDays(m.created, now) >= 0 &&
      ageDays(m.created, now) <= days,
  );
  const newest = (a: MapCard, b: MapCard) => b.created - a.created || a.pfid.localeCompare(b.pfid);
  if (key === "D")
    return eligible
      .filter((m) => m.entryCount >= 5)
      .sort(newest)
      .slice(0, 5)
      .map((m) => ({ m, recent: null, period: "7d", fallback: false }));
  const period = key === "B" ? "24h" : key === "C" ? "since publication" : "7d";
  const metric = (m: MapCard) =>
    key === "C" ? m.sessions : (activity.metrics[m.pfid]?.[key === "B" ? "day" : "week"] ?? null);
  const ranked = eligible
    .map(
      (m) =>
        ({
          m,
          recent: metric(m),
          period,
          fallback: metric(m) == null || (metric(m) ?? 0) <= 0,
        }) satisfies DiscoveryPick,
    )
    .sort(
      (a, b) =>
        Number(a.fallback) - Number(b.fallback) ||
        (a.fallback && b.fallback
          ? newest(a.m, b.m)
          : (b.recent ?? 0) - (a.recent ?? 0) || newest(a.m, b.m)),
    );
  if (key !== "E") return ranked.slice(0, 5);
  const pool = ranked.slice(0, 20);
  if (!pool.length) return [];
  const start = (Math.floor(now / 86400000) * 5) % pool.length;
  return Array.from(
    { length: Math.min(5, pool.length) },
    (_, i) => pool[(start + i) % pool.length],
  );
}
// END PROTOTYPE
