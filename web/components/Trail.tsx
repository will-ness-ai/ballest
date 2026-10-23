"use client";
// "Where I came from", kept for this tab's session: the parent a page's breadcrumb leads
// back to (crumbsOf in lib/nav.ts, drawn by PageHead). Two trails: a player's page goes back
// to the board the reader last looked at (a Circuit board, a Campaign, a Map's page, the
// Daily or the Players table render <Remember trail="board">), and a Map's page to the list,
// board or player it was reached from (the homepage, All maps, a Campaign, the Daily and a
// player's page render <Remember trail="maps">). With nothing kept, or storage blocked, the
// breadcrumb is the Section's own. Only a path on this site ever comes back out, so a stored
// value can't send the link elsewhere.
import { useEffect, useSyncExternalStore } from "react";

import { never } from "../hooks/client";
import type { Crumb } from "../lib/nav";

/* each trail's storage key */
const TRAILS = {
  board: "ballest-board",
  maps: "ballest-ws-list",
} as const;

export type Trail = keyof typeof TRAILS;

const read = (raw: string): Crumb | null => {
  try {
    const b = JSON.parse(raw) as Partial<Crumb>;
    return typeof b.href === "string" &&
      b.href.startsWith("/") &&
      !b.href.startsWith("//") &&
      typeof b.label === "string" &&
      b.label
      ? { href: b.href, label: b.label }
      : null;
  } catch {
    return null;
  }
};

/* note this page as where `trail`'s breadcrumb leads, by its path and its name */
export function Remember({ trail, href, label }: { trail: Trail; href: string; label: string }) {
  const key = TRAILS[trail];
  const value = JSON.stringify({ href, label });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* storage blocked: the breadcrumb is the Section's own */
    }
  }, [key, value]);
  return null;
}

const stored = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

/* the page `trail` remembers: null on the server, in hydration, or with nothing kept */
export function useTrail(trail: Trail | null): Crumb | null {
  const raw = useSyncExternalStore(
    never,
    () => (trail ? stored(TRAILS[trail]) : ""),
    () => "",
  );
  return raw ? read(raw) : null;
}
