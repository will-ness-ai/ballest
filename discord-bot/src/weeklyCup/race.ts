// The Weekly Cup's racing (spec #353, #358): from Friday 09:00 each Cup Map is read every 5
// minutes, one readPlayers call per Map for the current Entrants; a time counts once it beats the
// Entrant's bar (their PB as racing opened, or as they signed up if later) and their counted best,
// and a PB seen more than 30 minutes after their first counted time on that Map is a Flag, told to
// ops once per Entrant per Map. The standings are shown after each read; at Sunday 20:00 a final
// read of each Map (tried each minute for the ones Steam missed, up to 30 minutes) makes the
// results, posted once.
import { Effect, Option } from "effect";
import { formatTime } from "../domain.js";
import { mapName } from "../links.js";
import type { SteamUnavailable } from "../ports.js";
import type { CupKit } from "./kit.js";
import {
  type CupMap,
  FINAL_WAIT,
  FLAG_AFTER,
  LATE_READ_AFTER,
  READ_EVERY,
  RETRY_EVERY,
  type StandingsView,
} from "./model.js";
import { cupStandings } from "./points.js";
import type { Baseline, CupRecord, CupTime } from "./record.js";
import type { CupWeek } from "./week.js";

/** A week's race as the record has it: its Cup Maps in rank order, and every Entrant's bars. */
export interface Race {
  readonly maps: ReadonlyArray<CupMap>;
  readonly bars: ReadonlyArray<Baseline>;
}

interface Account {
  readonly discordId: string;
  readonly steamId: string;
}

export const makeRace = (kit: CupKit) => {
  const { guildId, log, steam, links } = kit;

  /** The week's Cup Maps in rank order, each with its votes; none before the vote closes. */
  const cupMapsOf = Effect.fn("cup.cupMapsOf")(function* (week: string) {
    return (yield* log.shortlist(guildId, week))
      .flatMap((s) => (s.cupRank === null ? [] : [{ ...s, cupRank: s.cupRank }]))
      .sort((a, b) => a.cupRank - b.cupRank)
      .map((s) => ({ map: s.map, votes: s.votes ?? 0 }));
  });

  const raceOf = Effect.fn("cup.raceOf")(function* (week: string) {
    const maps = (yield* cupMapsOf(week)).map((m) => m.map);
    return { maps, bars: yield* log.baselines(guildId, week) } satisfies Race;
  });

  /** These members' linked Steam accounts; one without a Link is left out. */
  const accountsOf = Effect.fn("cup.accountsOf")(function* (discordIds: ReadonlyArray<string>) {
    const found = yield* Effect.forEach(discordIds, (discordId) =>
      Effect.map(
        links.steamIdOf(discordId),
        Option.map((steamId): Account => ({ discordId, steamId })),
      ),
    );
    return found.flatMap(Option.toArray);
  });

  /** One Map's entries for these accounts, by whose they are: one readPlayers call. */
  const readMap = Effect.fn("cup.readMap")(function* (
    map: CupMap,
    accounts: ReadonlyArray<Account>,
  ) {
    if (accounts.length === 0) return [];
    const byAccount = new Map(accounts.map((a) => [a.steamId, a.discordId]));
    const entries = yield* steam.readPlayers(
      map.boardId,
      accounts.map((a) => a.steamId),
    );
    return entries.flatMap((e): Array<Baseline> => {
      const discordId = byAccount.get(e.steamId);
      return discordId === undefined ? [] : [{ pfid: map.pfid, discordId, ticks: e.ticks }];
    });
  });

  /** These members' PBs on these Maps now, as their bars; fails as soon as one read does. */
  const barsOf = Effect.fn("cup.barsOf")(function* (
    maps: ReadonlyArray<CupMap>,
    discordIds: ReadonlyArray<string>,
  ) {
    const accounts = yield* accountsOf(discordIds);
    return (yield* Effect.forEach(maps, (map) => readMap(map, accounts))).flat();
  });

  /**
   * Each of these Maps read once for the week's Entrants, each read on its own, so one Steam drops
   * keeps that Map's last times. A failed read reaches ops once until the reads land again. The
   * pfids of the Maps whose read landed.
   */
  const readTimes = Effect.fn("cup.readTimes")(function* (now: number, week: CupWeek, race: Race) {
    const accounts = yield* accountsOf(yield* kit.entrantIds(week.week));
    const held = new Map(
      (yield* log.times(guildId, week.week)).map((t) => [`${t.pfid} ${t.discordId}`, t]),
    );
    let failed: SteamUnavailable | null = null;
    const landed: Array<string> = [];
    for (const map of race.maps) {
      const read = yield* Effect.either(readMap(map, accounts));
      if (read._tag === "Left") {
        failed = read.left;
        continue;
      }
      landed.push(map.pfid);
      for (const entry of read.right) {
        const key = `${map.pfid} ${entry.discordId}`;
        const bar = race.bars.find((b) => b.pfid === map.pfid && b.discordId === entry.discordId);
        const before = held.get(key);
        if (bar !== undefined && entry.ticks >= bar.ticks) continue;
        if (before !== undefined && entry.ticks >= before.ticks) continue;
        // Measured between reads, not runs: the first counted time was set up to a read gap
        // (5 minutes, longer while Steam is down) before it was seen, and so was this one, so a
        // Flag is approximate either way; ops follows it up by hand.
        const flag = before !== undefined && !before.flagged && now - before.firstAt > FLAG_AFTER;
        const time: CupTime = {
          ...entry,
          firstAt: before?.firstAt ?? now,
          seenAt: now,
          flagged: (before?.flagged ?? false) || flag,
        };
        yield* log.putTime(guildId, week.week, time);
        held.set(key, time);
        if (before !== undefined && flag)
          yield* kit.alerts.post(
            `Weekly Cup Flag for ${week.week} in ${guildId}: <@${entry.discordId}> set ${formatTime(entry.ticks)} on ${mapName(map)}, ${Math.floor((now - before.firstAt) / 60_000)} minutes after their first time on it. It still counts.`,
          );
      }
    }
    yield* kit.attempt(
      "read",
      "read a Weekly Cup Map",
      week.week,
      failed === null ? Effect.void : Effect.fail(failed),
    );
    return landed;
  });

  /** The standings from the counted times, for the week's Entrants now. */
  const standingsOf = Effect.fn("cup.standingsOf")(function* (
    week: CupWeek,
    race: Race,
    final: boolean,
    finalReads: Readonly<Record<string, number>> = {},
  ) {
    const times: Record<string, Record<string, number>> = {};
    for (const t of yield* log.times(guildId, week.week))
      (times[t.pfid] ??= {})[t.discordId] = t.ticks;
    const standings = cupStandings(race.maps, yield* kit.entrantIds(week.week), times);
    const lateReads = final
      ? race.maps.flatMap((m): Array<StandingsView["lateReads"][number]> => {
          const at = finalReads[m.pfid];
          if (at === undefined) return [{ pfid: m.pfid, at: null }];
          return at - week.endsAt >= LATE_READ_AFTER ? [{ pfid: m.pfid, at }] : [];
        })
      : [];
    return {
      guildId,
      week,
      maps: race.maps,
      standings,
      final,
      lateReads,
    } satisfies StandingsView;
  });

  /** Racing: read the Cup Maps, show the standings, and read again in 5 minutes. */
  const live = Effect.fn("cup.live")(function* (now: number, week: CupWeek, cup: CupRecord) {
    const race = yield* raceOf(week.week);
    yield* readTimes(now, week, race);
    const view = yield* standingsOf(week, race, false);
    yield* kit.show(week, cup, "standings", view, "update the Weekly Cup's standings");
    return Math.min(now + READ_EVERY, week.endsAt);
  });

  /**
   * Sunday 20:00: a final read of each Cup Map, recorded as it lands (`finalReads`), so a retry
   * each minute while Steam fails reads only the Maps still missing, until 30 minutes on, when
   * those stand on their last reads; then the results, saying which Maps were read late, posted
   * once (recorded as they go up, so a restart never posts them again), and the week is final.
   */
  const finish = Effect.fn("cup.finish")(function* (now: number, week: CupWeek, cup: CupRecord) {
    let current = cup;
    if (current.shown.results.length === 0) {
      const race = yield* raceOf(week.week);
      const missing = race.maps.filter((m) => current.finalReads[m.pfid] === undefined);
      const landed =
        missing.length === 0 ? [] : yield* readTimes(now, week, { ...race, maps: missing });
      if (landed.length > 0) {
        const finalReads = { ...current.finalReads };
        for (const pfid of landed) finalReads[pfid] = now;
        current = { ...current, finalReads };
        yield* log.put(guildId, week.week, current);
      }
      if (landed.length < missing.length && now < week.endsAt + FINAL_WAIT)
        return now + RETRY_EVERY;
      const view = yield* standingsOf(week, race, true, current.finalReads);
      const posted = yield* kit.show(
        week,
        current,
        "results",
        view,
        "post the Weekly Cup's results",
      );
      if (Option.isNone(posted)) return now + RETRY_EVERY;
      current = posted.value;
    }
    yield* kit.enter(week, current, "final");
    return week.nextOpensAt;
  });

  return { cupMapsOf, barsOf, live, finish };
};

export type CupRace = ReturnType<typeof makeRace>;
