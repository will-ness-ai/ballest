"use client";
// "Where I came from", kept for this tab's session: the parent a page's breadcrumb leads
// back to (crumbsOf in lib/nav.ts, drawn by PageHead). Two trails: a player's page goes back
// to the board the reader last looked at (a Circuit board, a Campaign, a Map's page, the
// Daily or the Players table render <Remember trail="board">), and a Map's page to the list,
// board or player it was reached from (the homepage, All maps, a Campaign, the Daily and a
// player's page render <Remember trail="maps">). A page that leads to only some of the trail's
// pages says so, and is the parent of those alone: a Campaign or a Daily names its Maps
// (`leads`), and a player's page names the player (`player`), the parent of a Map they made or
// have a time on, which the Map's page asks its own board about. A plain click on a Section's
// link or a search hit that leaves the page forgets both trails (forgetTrails), since the
// reader has set off somewhere new. With nothing kept, or storage blocked, the breadcrumb is
// the Section's own. Only a path on this site ever comes back out, so a stored value can't send
// the link elsewhere.
import { useEffect, useSyncExternalStore } from "react";

import { never } from "../hooks/client";
import { useRead } from "../hooks/read";
import { boardRowHref, readRow } from "../hooks/you";
import type { Crumb } from "../lib/nav";
import { isSteamId } from "../lib/rules";

/* each trail's storage key */
const TRAILS = {
  board: "ballest-board",
  maps: "ballest-ws-list",
} as const;

export type Trail = keyof typeof TRAILS;

/* the page a breadcrumb is drawn on, as a remembered player is checked against it: its board
   and who made it */
export interface TrailPage {
  board: string;
  maker: string | null;
}

/* the remembered page, if it can lead to `here`, with the player it leads through */
const read = (raw: string, here: string): { crumb: Crumb; player: string | null } | null => {
  try {
    const b = JSON.parse(raw) as Partial<Crumb> & { leads?: unknown; player?: unknown };
    if (Array.isArray(b.leads) && !b.leads.includes(here)) return null;
    const player = typeof b.player === "string" && isSteamId(b.player) ? b.player : null;
    if (b.player != null && !player) return null;
    return typeof b.href === "string" &&
      b.href.startsWith("/") &&
      !b.href.startsWith("//") &&
      typeof b.label === "string" &&
      b.label
      ? { crumb: { href: b.href, label: b.label }, player }
      : null;
  } catch {
    return null;
  }
};

/* note this page as where `trail`'s breadcrumb leads, by its path and its name; `leads`, the
   paths of the trail's pages it links to, or `player`, whose made and finished Maps they are,
   where that is not every one */
export function Remember({
  trail,
  href,
  label,
  leads,
  player,
}: {
  trail: Trail;
  href: string;
  label: string;
  leads?: ReadonlyArray<string>;
  player?: string;
}) {
  const key = TRAILS[trail];
  const value = JSON.stringify({ href, label, leads, player });
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

/* a click that opens `href` in this tab: the main button, no key held (Ctrl/Cmd/Shift/Alt
   open a new tab or window, or download), and not a link marked for another window */
const plain = (e: React.MouseEvent<HTMLAnchorElement>) =>
  e.button === 0 &&
  !e.metaKey &&
  !e.ctrlKey &&
  !e.shiftKey &&
  !e.altKey &&
  !(e.currentTarget.target && e.currentTarget.target !== "_self");

/* forget where every trail leads, as the reader goes to `href` from a Section's link or a
   search hit; `e`, the click that took them, when it was one. A click that opens another tab,
   or a link to the page already open, leaves this one as it was */
export function forgetTrails(href: string, e?: React.MouseEvent<HTMLAnchorElement>) {
  if (e && !plain(e)) return;
  if (new URL(href, location.href).pathname === location.pathname) return;
  try {
    for (const key of Object.values(TRAILS)) sessionStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing was kept */
  }
}

/* the page `trail` remembers, if it leads to `here` (`page`: what a remembered player is
   checked against; without it a player leads nowhere): null on the server, in hydration, with
   nothing kept, and while a player's row on `page`'s board is read */
export function useTrail(trail: Trail | null, here: string, page?: TrailPage): Crumb | null {
  const raw = useSyncExternalStore(
    never,
    () => (trail ? stored(TRAILS[trail]) : ""),
    () => "",
  );
  const kept = raw ? read(raw, here) : null;
  const player = kept?.player ?? null;
  const ask = player && page && player !== page.maker ? boardRowHref(page.board, player) : null;
  const row = useRead(readRow, ask);
  if (!kept) return null;
  if (!player) return kept.crumb;
  if (!page) return null;
  return player === page.maker || row?.value ? kept.crumb : null;
}
