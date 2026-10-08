"use client";
// "This is me": one Steam ID, kept in this browser and nowhere else. The player it names is
// You (CONTEXT.md): the header's card links to their page, a player's page shows the score
// card against them, and the Players table pins their row. Every component that reads it
// updates when any of them sets it, in this tab or another.
import { useSyncExternalStore } from "react";

import { useMounted } from "./client";
import { readOnce, useRead } from "./read";
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

/* a player's record from GET /api/player/<id>, or "unknown" for a Steam ID on no board (the
   API's 404); any other answer is a failed read */
const readRecord = readOnce(async (id): Promise<PlayerRecord | "unknown"> => {
  const r = await fetch("/api/player/" + id);
  if (r.ok) return (await r.json()) as PlayerRecord;
  if (r.status === 404) return "unknown";
  throw new Error(String(r.status));
});

/* You, with your record. "none" with no claim, or a claim on a Steam ID the site doesn't
   know; "loading" on the server, during hydration, until the record lands, and after a read
   that failed, so nothing is drawn from it. `claimed` says a claim is known to exist, so a
   view of You can hold its place rather than jump in when the record lands */
export type You =
  | { state: "none" }
  | { state: "loading"; claimed: boolean }
  | { state: "ready"; id: string; rec: PlayerRecord };

export function useYou(): You {
  const mounted = useMounted();
  const me = useMe();
  const got = useRead(readRecord, me);
  if (!mounted) return { state: "loading", claimed: false };
  if (!me || got?.value === "unknown") return { state: "none" };
  return got ? { state: "ready", id: me, rec: got.value } : { state: "loading", claimed: true };
}
