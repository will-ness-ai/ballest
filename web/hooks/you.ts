"use client";
// You on one board: your row (rank and score) on the board a page shows, read once per page
// load from /api/board/<name>?player=<you>. Who You are comes from useYou (hooks/me.ts)
// alone; every view that shows You on a board (the banner, the graph line, the highlights)
// reads this hook, so they share one request and agree.
import { useEffect, useState } from "react";

import { useYou } from "./me";
import type { PlayerRecord } from "../lib/player";
import type { YourRow } from "../lib/standing";

export type YouOnBoard =
  /* nobody claimed in this browser, or a claim on a Steam ID the site doesn't know */
  | { kind: "unset" }
  /* not known yet: hydrating, or You's record or row still being read (or a read failed) */
  | { kind: "loading" }
  /* You, with no Entry on this board */
  | { kind: "unplayed"; who: PlayerRecord["who"] }
  | { kind: "played"; who: PlayerRecord["who"]; row: YourRow };

/* one read per board and player for the page's lifetime; a failed read is forgotten so a
   later mount tries again */
const READS = new Map<string, Promise<YourRow | null>>();

function readRow(name: string, id: string): Promise<YourRow | null> {
  const key = name + "\n" + id;
  let p = READS.get(key);
  if (!p) {
    p = fetch(`/api/board/${encodeURIComponent(name)}?player=${id}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<YourRow | null>;
    });
    p.catch(() => READS.delete(key));
    READS.set(key, p);
  }
  return p;
}

export function useYouOnBoard(name: string): YouOnBoard {
  const you = useYou();
  const id = you.state === "ready" ? you.id : null;
  const [got, setGot] = useState<{ key: string; row: YourRow | null } | null>(null);
  const key = name + "\n" + (id ?? "");
  useEffect(() => {
    if (!id) return;
    let live = true;
    readRow(name, id).then(
      (row) => {
        if (live) setGot({ key, row });
      },
      () => undefined /* stays loading: draw nothing rather than a wrong state */,
    );
    return () => {
      live = false;
    };
  }, [name, id, key]);
  if (you.state === "none") return { kind: "unset" };
  if (you.state === "loading" || got?.key !== key) return { kind: "loading" };
  const who = you.rec.who;
  return got.row ? { kind: "played", who, row: got.row } : { kind: "unplayed", who };
}
