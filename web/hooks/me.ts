"use client";
// Who is signed in (ADR 0008). The player it names is You (CONTEXT.md): the header's card
// links to their page, a player's page shows the score card against them, and the Players
// table pins their row. Pages are cached for everyone, so the browser asks /api/me once per
// page load, and only when the readable hint cookie says a session exists.
import { useSyncExternalStore } from "react";

import { useMounted, never } from "./client";
import { readOnce, useRead } from "./read";
import type { PlayerRecord } from "../lib/player";
import { isSteamId } from "../lib/rules";

/* the hint cookie lib/session.ts sets beside the session */
const hinted = () => /(?:^|;\s*)ballest-in=1(?:;|$)/.test(document.cookie);

const readMe = readOnce(async (): Promise<string | null> => {
  const r = await fetch("/api/me", { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const { id } = (await r.json()) as { id: unknown };
  return isSteamId(id) ? id : null;
});

/* null signed out; undefined until the browser can tell: on the server, during hydration,
   and while /api/me is asked */
function useSession(): string | null | undefined {
  const signedIn = useSyncExternalStore(never, hinted, () => null);
  const got = useRead(readMe, signedIn ? "me" : null);
  if (signedIn === null) return undefined;
  if (!signedIn) return null;
  return got ? got.value : undefined;
}

/* the signed-in Steam ID; null on the server, during hydration, while it is asked, or when
   nobody is signed in */
export const useMe = () => useSession() ?? null;

/* a player's record from GET /api/player/<id>, or "unknown" for a Steam ID on no board (the
   API's 404); any other answer is a failed read */
const readRecord = readOnce(async (id): Promise<PlayerRecord | "unknown"> => {
  const r = await fetch("/api/player/" + id);
  if (r.ok) return (await r.json()) as PlayerRecord;
  if (r.status === 404) return "unknown";
  throw new Error(String(r.status));
});

/* You, with your record. "none" signed out, or signed in as a Steam ID the site doesn't
   know; "loading" on the server, during hydration, until the record lands, and after a read
   that failed, so nothing is drawn from it. `claimed` says a session is known to exist, so
   a view of You can hold its place rather than jump in when the record lands */
export type You =
  | { state: "none" }
  | { state: "loading"; claimed: boolean }
  | { state: "ready"; id: string; rec: PlayerRecord };

export function useYou(): You {
  const mounted = useMounted();
  const me = useSession();
  const got = useRead(readRecord, me ?? null);
  if (!mounted) return { state: "loading", claimed: false };
  if (me === undefined) return { state: "loading", claimed: true };
  if (!me || got?.value === "unknown") return { state: "none" };
  return got ? { state: "ready", id: me, rec: got.value } : { state: "loading", claimed: true };
}
