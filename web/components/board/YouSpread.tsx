"use client";
// The spread chart with You's time on it, once your row on the board has been read. Until
// then, and signed out or with no time here, it is the same chart the server drew.
import { Spread } from "./Spread";
import { useYouOnBoard } from "../../hooks/you";
import type { SpreadChart } from "../../lib/spread";

/* `name` is the board your row is read from; `chart` is worked out on the server
   (spreadOf), so only its columns reach the browser */
export function YouSpread({ name, chart }: { name: string; chart: SpreadChart }) {
  const you = useYouOnBoard(name);
  return (
    <Spread
      chart={chart}
      you={you.kind === "played" ? { score: you.row.score, id: you.who.steamId } : null}
    />
  );
}
