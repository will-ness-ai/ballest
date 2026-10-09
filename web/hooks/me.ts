"use client";
// Who is signed in (ADR 0008). The player it names is You (CONTEXT.md): the header's card
// links to their page, a player's page shows the score card against them, and the Players
// table pins their row. Pages are cached for everyone, so the browser asks /api/me once per
// page load, and only when the readable hint cookie says a session exists. The hint is read
// again whenever the tab comes back into view, so signing out in another tab shows here.
import { useSyncExternalStore } from "react";

import { useMounted } from "./client";
import { readOnce, useRead } from "./read";
import type { PlayerRecord } from "../lib/player";
import { HINT_COOKIE } from "../lib/cookies";
import { isSteamId } from "../lib/rules";

const hinted = () => document.cookie.split(";").some((c) => c.trim() === HINT_COOKIE + "=1");
function onReturn(changed: () => void) {
  addEventListener("focus", changed);
  document.addEventListener("visibilitychange", changed);
  return () => {
    removeEventListener("focus", changed);
    document.removeEventListener("visibilitychange", changed);
  };
}

/* the signed-in Steam ID, or null. A failed read counts as signed out, so a page never
   waits on it for good; the next page load asks again */
const readMe = readOnce(async (): Promise<string | null> => {
  try {
    const r = await fetch("/api/me", { cache: "no-store" });
    const { id } = (await r.json()) as { id: unknown };
    return r.ok && isSteamId(id) ? id : null;
  } catch {
    return null;
  }
});

/* null signed out; undefined until the browser can tell: on the server, during hydration,
   and while /api/me is asked */
function useSession(): string | null | undefined {
  const signedIn = useSyncExternalStore(onReturn, hinted, () => null);
  const got = useRead(readMe, signedIn ? "me" : null);
  if (signedIn === null) return undefined;
  if (!signedIn) return null;
  return got ? got.value : undefined;
}

/* a player's record from GET /api/player/<id>, or "unknown" for a Steam ID on no board (the
   API's 404); any other answer, or a record for another Steam ID, is a failed read. The
   check is what lets views put the record's ID in a link */
const readRecord = readOnce(async (id): Promise<PlayerRecord | "unknown"> => {
  const r = await fetch("/api/player/" + id);
  if (r.ok) {
    const rec = (await r.json()) as PlayerRecord;
    if (rec.id === id && rec.who.steamId === id && isSteamId(id)) return rec;
    throw new Error("a record for another player");
  }
  if (r.status === 404) return "unknown";
  throw new Error(String(r.status));
});

/* You, with your record. "none" signed out; "unknown" signed in as a Steam ID on no board
   yet, so there is nothing to show but a way to sign out; "loading" on the server, during
   hydration, until the record lands, and after a read that failed, so nothing is drawn
   from it. `claimed` says a session is known to exist, so
   a view of You can hold its place rather than jump in when the record lands */
export type You =
  | { state: "none" }
  | { state: "unknown"; id: string }
  | { state: "loading"; claimed: boolean }
  | { state: "ready"; id: string; rec: PlayerRecord };

export function useYou(): You {
  const mounted = useMounted();
  const me = useSession();
  const got = useRead(readRecord, me ?? null);
  if (!mounted) return { state: "loading", claimed: false };
  if (me === undefined) return { state: "loading", claimed: true };
  if (!me) return { state: "none" };
  if (got?.value === "unknown") return { state: "unknown", id: me };
  return got ? { state: "ready", id: me, rec: got.value } : { state: "loading", claimed: true };
}
