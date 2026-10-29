// The Eligible Map search (GLOSSARY.md), shared by a Match's draw (engine.ts) and the Weekly Cup's
// Shortlist (weeklyCup/vote.ts). The author-time limit filters the Workshop list for free;
// each shuffled candidate then costs one board check (world record, who has Played it), so only
// the Maps actually tried are ever read, and at most `maxChecks` are.
import { Chunk, Effect, Random } from "effect";
import { type DrawnMap, worldRecordFits } from "./domain.js";
import { Steam } from "./ports.js";

export interface EligibleSearch {
  /** The longest author time a candidate may have, in seconds. */
  readonly authorLimitSeconds: number;
  /** Whose Played Maps count against a candidate. */
  readonly steamIds: ReadonlyArray<string>;
  /** Stop once this many Maps nobody here has Played are found. */
  readonly want: number;
  readonly maxChecks: number;
  /** A board check that Steam drops is retried this many times. */
  readonly retries: number;
}

/**
 * Up to `want` random Eligible Maps none of these Players has Played, in the order they were
 * drawn, and, among those tried that some had Played, the one the fewest had (their PBs on it in
 * `personalBests`), or null.
 */
export const searchEligible = Effect.fn("EligibleMaps.search")(function* (search: EligibleSearch) {
  const steam = yield* Steam;
  const catalogue = yield* steam.catalogue;
  const shuffled = yield* Random.shuffle(
    catalogue.filter((map) => map.medals.author <= search.authorLimitSeconds),
  );
  const unplayed: Array<DrawnMap> = [];
  let fallback: DrawnMap | null = null;
  for (const map of Chunk.take(shuffled, search.maxChecks)) {
    const c = yield* steam
      .check(map, search.steamIds)
      .pipe(Effect.retry({ times: search.retries }));
    if (c.boardId === null || c.worldRecordTicks === null || !worldRecordFits(c.worldRecordTicks))
      continue;
    const drawn: DrawnMap = {
      ...map,
      boardId: c.boardId,
      worldRecordTicks: c.worldRecordTicks,
      personalBests: Object.fromEntries(c.played.map((e) => [e.steamId, e.ticks])),
    };
    if (c.played.length === 0) {
      unplayed.push(drawn);
      if (unplayed.length >= search.want) break;
    } else if (fallback === null || c.played.length < Object.keys(fallback.personalBests).length)
      fallback = drawn;
  }
  return { unplayed, fallback };
});
