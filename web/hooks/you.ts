"use client";
// You on one board: your row (rank and score) on the board a page shows, read once per page
// load from /api/board/<name>?player=<you>. Who You are comes from useYou (hooks/me.ts)
// alone; every view that shows You on a board (the banner, the graph line, the highlights)
// reads this hook, so they share one request and agree.
import { useYou } from "./me";
import { readOnce, useRead } from "./read";
import type { PlayerRecord } from "../lib/player";
import type { YourRow } from "../lib/standing";

export type YouOnBoard =
  /* signed out */
  | { kind: "none" }
  /* signed in as a Steam ID on no board yet */
  | { kind: "unknown" }
  /* not known yet: hydrating, or You's record or row still being read (or a read failed).
     `claimed` as in useYou: a session is known to exist */
  | { kind: "loading"; claimed: boolean }
  /* You, with no Entry on this board */
  | { kind: "unplayed"; who: PlayerRecord["who"] }
  | { kind: "played"; who: PlayerRecord["who"]; row: YourRow };

/* the key is the request's path, so a board and a player are read once together */
const readRow = readOnce(async (path): Promise<YourRow | null> => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as YourRow | null;
});

export function useYouOnBoard(name: string): YouOnBoard {
  const you = useYou();
  const path =
    you.state === "ready"
      ? `/api/board/${encodeURIComponent(name)}?player=${encodeURIComponent(you.id)}`
      : null;
  const got = useRead(readRow, path);
  if (you.state === "none") return { kind: "none" };
  if (you.state === "unknown") return { kind: "unknown" };
  if (you.state === "loading") return { kind: "loading", claimed: you.claimed };
  if (!got) return { kind: "loading", claimed: true };
  const who = you.rec.who;
  return got.value ? { kind: "played", who, row: got.value } : { kind: "unplayed", who };
}
