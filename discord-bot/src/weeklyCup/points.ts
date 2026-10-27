// The Weekly Cup's scoring (spec #353): on each Cup Map its Entrants are ranked by time (equal
// times share a place) and paid the Circuit's place points; no time scores 0. The Cup total is
// the sum, and a tie on it goes to more Map wins; Entrants level on both share the place.

/**
 * What a place pays: the Circuit's rule, as the site's `trackPoints` (web/lib/rules.ts) has it,
 * held to it by test/weeklyCupPoints.test.ts. 1st pays 40,000, 10th a tenth of it, then it halves
 * at every 10x in place.
 */
export const POINTS_FIRST = 40000;
export const cupPoints = (place: number): number => {
  if (place <= 10) return Math.floor(POINTS_FIRST / place);
  const k = String(place - 1).length - 1; // place is in (10^k, 10^(k+1)]
  return Math.floor((POINTS_FIRST * 9) / 100 / 2 ** k + (POINTS_FIRST * 5 ** k) / 10 / place);
};

export interface MapRow {
  readonly discordId: string;
  /** The counted best, in ticks; null for no time. */
  readonly ticks: number | null;
  /** 1-based, shared by equal times; null for no time. */
  readonly rank: number | null;
  readonly points: number;
}

export interface OverallRow {
  readonly discordId: string;
  readonly total: number;
  /** How many Cup Maps they won (1st, shared or not). */
  readonly wins: number;
  /** 1-based, shared by Entrants level on total and wins. */
  readonly place: number;
}

export interface CupStandings {
  readonly maps: ReadonlyArray<{
    readonly pfid: string;
    readonly title: string;
    /** Fastest first, then those with no time in sign-up order. */
    readonly rows: ReadonlyArray<MapRow>;
  }>;
  /** Best first; level Entrants in sign-up order. */
  readonly overall: ReadonlyArray<OverallRow>;
}

/**
 * The standings from each Cup Map's counted times (by pfid, then Discord id), for `entrants` in
 * sign-up order: times of anyone else are left out.
 */
export const cupStandings = (
  maps: ReadonlyArray<{ readonly pfid: string; readonly title: string }>,
  entrants: ReadonlyArray<string>,
  times: Readonly<Record<string, Readonly<Record<string, number>>>>,
): CupStandings => {
  const ranked = maps.map((map) => {
    const onMap = times[map.pfid] ?? {};
    const timed = entrants
      .flatMap((id) => {
        const ticks = onMap[id];
        return ticks === undefined ? [] : [{ discordId: id, ticks }];
      })
      .sort((a, b) => a.ticks - b.ticks);
    const rows: Array<MapRow> = timed.map((t) => {
      const rank = timed.findIndex((u) => u.ticks === t.ticks) + 1;
      return { discordId: t.discordId, ticks: t.ticks, rank, points: cupPoints(rank) };
    });
    for (const id of entrants)
      if (!(id in onMap)) rows.push({ discordId: id, ticks: null, rank: null, points: 0 });
    return { pfid: map.pfid, title: map.title, rows };
  });
  const totals = entrants.map((discordId) => {
    const mine = ranked.flatMap((m) => m.rows.filter((r) => r.discordId === discordId));
    return {
      discordId,
      total: mine.reduce((sum, r) => sum + r.points, 0),
      wins: mine.filter((r) => r.rank === 1).length,
    };
  });
  const order = [...totals].sort((a, b) => b.total - a.total || b.wins - a.wins);
  const overall = order.map((t) => ({
    ...t,
    place: order.findIndex((u) => u.total === t.total && u.wins === t.wins) + 1,
  }));
  return { maps: ranked, overall };
};
