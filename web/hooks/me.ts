"use client";
// "This is me": one Steam ID, kept in this browser and nowhere else. A player's page shows
// the score card against it, and the Players table pins its row. Every component that
// reads it updates when any of them sets it.
import { useSyncExternalStore } from "react";

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
