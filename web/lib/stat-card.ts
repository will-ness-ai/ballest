// What a player's Stat Card says (spec #323): the portrait card See my stats answers with in
// Discord. Pure, so its rules are tested here; components/share/StatCard.tsx draws it and
// app/og/stats serves it. The design was settled in grill-design (K5 with its date as T1,
// prototype branch claude/prototype-statcard).
import type { PlayerRecord } from "./player";
import { fmtN, hueFor, personaOf } from "./rules";
import { SKINS } from "./skins";

/* a row's mark: a season's, a Medal's, or the player's own marble for Maps finished */
export type StatRowKind = "s1" | "s2" | "wr" | "author" | "gold" | "silver" | "bronze" | "finished";

export interface StatRow {
  kind: StatRowKind;
  label: string;
  value: string;
}

export interface StatCard {
  name: string;
  /* the marble's hue, and the frame's */
  hue: number;
  /* the Chosen Skin's asset, whose picture the ball wears, or null for the hue marble */
  skin: string | null;
  /* only the rows the player has: a missing rank or a count of zero is left out */
  rows: Array<StatRow>;
  /* the Refresh the numbers are from, "22 OCT 2026" */
  date: string;
}

/* a day in UTC, its month short and upper case: the card is read the world over */
export function cardDate(ms: number) {
  const d = new Date(ms);
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${String(d.getUTCDate())} ${month.toUpperCase()} ${String(d.getUTCFullYear())}`;
}

/* A player's Stat Card, as of the Refresh at asOf. The ranks are each season's Overall
   board's. Every count adds the Circuit's Tracks and the Workshop's Maps together, as
   playerCard does: a world record is rank 1 on either, and the Medals count what each
   finish's time earned, so an Author medal includes a world record at the author time. */
export function statCard(
  rec: PlayerRecord,
  asOf: number,
  chosenSkin: string | undefined,
): StatCard {
  const ws = rec.workshop;
  const run = rec.seasons.flatMap((s) => s.tiers.flatMap((t) => t.tracks));
  const earned = (k: "author" | "gold" | "silver" | "bronze") =>
    run.filter((t) => t.finish?.earned === k).length +
    ws.finishes.filter((f) => f.earned === k).length;
  const rank = (group: string) => {
    const o = rec.seasons.find((s) => s.group === group)?.overall;
    return o ? "#" + fmtN(o.rank) : null;
  };
  const count = (n: number) => (n > 0 ? fmtN(n) : null);
  const rows: Array<[StatRowKind, string, string | null]> = [
    ["s1", "Season 1 Circuit", rank("Season 1")],
    ["s2", "Season 2 Circuit", rank("Season 2")],
    ["wr", "World records", count(rec.medals.gold + ws.medals.wr)],
    ["author", "Author medals", count(earned("author"))],
    ["gold", "Gold medals", count(earned("gold"))],
    ["silver", "Silver medals", count(earned("silver"))],
    ["bronze", "Bronze medals", count(earned("bronze"))],
    ["finished", "Maps finished", count(rec.run + ws.finishes.length)],
  ];
  return {
    name: personaOf(rec.who),
    hue: hueFor(rec.id),
    skin: (chosenSkin ? SKINS.get(chosenSkin) : undefined) ?? null,
    rows: rows.flatMap(([kind, label, value]) => (value ? [{ kind, label, value }] : [])),
    date: cardDate(asOf),
  };
}
