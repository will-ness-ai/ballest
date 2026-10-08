"use client";
// You on one board: your row (rank and score) on the board a page shows, read once per page
// load from /api/board/<name>?player=<you>. Who You are comes from useMe alone; every view
// that shows You on a board (the banner, the graph line, the highlights) reads this hook,
// so they share one request and agree.
import { useEffect, useState } from "react";

import { useMe } from "./me";
import type { YourRow } from "../lib/standing";

export type YouOnBoard =
  /* nobody claimed in this browser */
  | { kind: "unset" }
  /* claimed, row still being read */
  | { kind: "loading"; id: string }
  /* claimed, and no Entry on this board (or a Steam ID nobody raced under) */
  | { kind: "unplayed"; id: string }
  | { kind: "played"; id: string; row: YourRow };

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
  const id = useMe();
  const [got, setGot] = useState<{ key: string; row: YourRow | null } | null>(null);
  const key = name + "\n" + (id ?? "");
  useEffect(() => {
    if (!id) return;
    let live = true;
    readRow(name, id).then(
      (row) => {
        if (live) setGot({ key, row });
      },
      () => undefined /* stays loading: the banner draws nothing rather than a wrong state */,
    );
    return () => {
      live = false;
    };
  }, [name, id, key]);
  if (!id) return { kind: "unset" };
  if (got?.key !== key) return { kind: "loading", id };
  return got.row ? { kind: "played", id, row: got.row } : { kind: "unplayed", id };
}
