"use client";
// The spread chart with You's run on it, once your row on the board has been read. Until
// then, and with no claim or no time here, it is the same chart the server drew.
import { Spread } from "./Spread";
import { useYouOnBoard } from "../../hooks/you";
import type { SpreadChart } from "../../lib/spread";

export function YouSpread({
  name,
  chart,
  medals,
  wide,
}: {
  /* the board's name, which your row is read from */
  name: string;
  chart: SpreadChart;
  medals: ReadonlyArray<number>;
  wide: boolean;
}) {
  const you = useYouOnBoard(name);
  return (
    <Spread
      chart={chart}
      medals={medals}
      wide={wide}
      you={you.kind === "played" ? { score: you.row.score, id: you.who.steamId } : null}
    />
  );
}
