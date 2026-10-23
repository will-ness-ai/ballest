"use client";
// "Where I came from", kept for this tab's session: the parent a page's breadcrumb leads
// back to (crumbsOf in lib/nav.ts, drawn by PageHead). Two trails: a player's page goes back
// to the board the reader last looked at (a Circuit board, a Campaign, a Map's page, the
// Daily or the Players table render <Remember trail="board">), and a Map's page to the list,
// board or player it was reached from (the homepage, All maps, a Campaign, the Daily and a
// player's page render <Remember trail="maps">). A page that leads to only some of the trail's
// pages names them (`leads`: a Campaign its Maps, a Daily its Map, a player the Maps they made
// or played), and is the parent of those alone. A Section's link or a search hit forgets both
// trails (forgetTrails), since the reader has set off somewhere new. With nothing kept, or
// storage blocked, the breadcrumb is the Section's own. Only a path on this site ever comes
// back out, so a stored value can't send the link elsewhere.
import { useEffect, useSyncExternalStore } from "react";

import { never } from "../hooks/client";
import type { Crumb } from "../lib/nav";

/* each trail's storage key */
const TRAILS = {
  board: "ballest-board",
  maps: "ballest-ws-list",
} as const;

export type Trail = keyof typeof TRAILS;

/* the remembered page, if it leads to `here` */
const read = (raw: string, here: string): Crumb | null => {
  try {
    const b = JSON.parse(raw) as Partial<Crumb> & { leads?: unknown };
    if (Array.isArray(b.leads) && !b.leads.includes(here)) return null;
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

/* note this page as where `trail`'s breadcrumb leads, by its path and its name; `leads`, the
   paths of the trail's pages it links to, where that is not every one */
export function Remember({
  trail,
  href,
  label,
  leads,
}: {
  trail: Trail;
  href: string;
  label: string;
  leads?: ReadonlyArray<string>;
}) {
  const key = TRAILS[trail];
  const value = JSON.stringify({ href, label, leads });
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

/* forget where every trail leads: the reader followed a Section's link or a search hit */
export function forgetTrails() {
  try {
    for (const key of Object.values(TRAILS)) sessionStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing was kept */
  }
}

/* the page `trail` remembers, if it leads to `here`: null on the server, in hydration, or
   with nothing kept */
export function useTrail(trail: Trail | null, here: string): Crumb | null {
  const raw = useSyncExternalStore(
    never,
    () => (trail ? stored(TRAILS[trail]) : ""),
    () => "",
  );
  return raw ? read(raw, here) : null;
}
