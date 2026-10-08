"use client";
// "This is me": one Steam ID, kept in this browser and nowhere else. The player it names is
// You (CONTEXT.md): the header's card links to their page, a player's page shows the score
// card against them, and the Players table pins their row. Every component that reads it
// updates when any of them sets it, in this tab or another.
import { useEffect, useState, useSyncExternalStore } from "react";

import type { PlayerRecord } from "../lib/player";
import { isSteamId } from "../lib/rules";

const ME_KEY = "ballest-me";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    const id = localStorage.getItem(ME_KEY);
    return isSteamId(id) ? id : null;
  } catch {
    return null;
  }
}

/* null clears it */
export function setMe(id: string | null) {
  try {
    if (id && isSteamId(id)) localStorage.setItem(ME_KEY, id);
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* storage blocked: it lasts as long as nothing re-reads it */
  }
  for (const l of listeners) l();
}

function subscribe(changed: () => void) {
  listeners.add(changed);
  addEventListener("storage", changed);
  return () => {
    listeners.delete(changed);
    removeEventListener("storage", changed);
  };
}

/* the remembered Steam ID; null on the server, during hydration, or when none is set */
export const useMe = () => useSyncExternalStore(subscribe, read, () => null);

/* false on the server and during hydration, while useMe can't yet tell "none set" from
   "not read yet" */
const never = () => () => {
  /* nothing to unsubscribe: it never changes after hydration */
};
const useHydrated = () =>
  useSyncExternalStore(
    never,
    () => true,
    () => false,
  );

/* a record, "unknown" for a Steam ID on no board (the API's 404), or null for a read that
   failed */
type Read = PlayerRecord | "unknown" | null;

/* records read once each, for as long as the page is open; a failed read is tried again
   on the next page */
const RECORDS = new Map<string, Promise<Read>>();
function loadRecord(id: string) {
  let p = RECORDS.get(id);
  if (!p) {
    p = fetch("/api/player/" + id)
      .then((r): Read | Promise<Read> => {
        if (r.ok) return r.json() as Promise<PlayerRecord>;
        return r.status === 404 ? ("unknown" as const) : null;
      })
      .catch(() => null);
    RECORDS.set(id, p);
    void p.then((rec) => {
      if (!rec) RECORDS.delete(id);
    });
  }
  return p;
}

/* You, with your record from GET /api/player/<id>. "none" with no claim, or a claim on a
   Steam ID the site doesn't know; "loading" on the server, during hydration, until the
   record lands, and after a read that failed, so nothing is drawn from it */
export type You =
  { state: "none" } | { state: "loading" } | { state: "ready"; id: string; rec: PlayerRecord };

export function useYou(): You {
  const hydrated = useHydrated();
  const me = useMe();
  const [read, setRead] = useState<{ id: string; rec: Read } | null>(null);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadRecord(me).then((rec) => {
      if (live) setRead({ id: me, rec });
    });
    return () => {
      live = false;
    };
  }, [me]);
  if (!hydrated) return { state: "loading" };
  if (!me) return { state: "none" };
  const rec = read?.id === me ? read.rec : null;
  if (rec === "unknown") return { state: "none" };
  return rec ? { state: "ready", id: me, rec } : { state: "loading" };
}
