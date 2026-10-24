"use client";
// Small hooks the client components share.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isLive } from "../lib/daily";
import type { Freshness } from "../lib/rows";

/* a useSyncExternalStore subscription for a value that never changes once the page runs:
   its server snapshot shows until hydration is done, then the browser's */
export const never = () => () => undefined;

/* true once the page is running in a browser, false in the server render and hydration */
export const useMounted = () =>
  useSyncExternalStore(
    never,
    () => true,
    () => false,
  );

/* The time, for "... ago": null on the server and during hydration, since a cached page
   would freeze it, then the browser's clock, moving on every minute and at once when the
   tab comes back into view (a sleeping laptop's timers stop). */
let now = 0;
function tick(changed: () => void) {
  now = Date.now();
  const move = () => {
    now = Date.now();
    changed();
  };
  const back = () => {
    if (document.visibilityState === "visible") move();
  };
  const t = setInterval(move, 60_000);
  document.addEventListener("visibilitychange", back);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", back);
  };
}
export const useNow = () =>
  useSyncExternalStore(
    tick,
    () => now || (now = Date.now()),
    () => null,
  );

/* how long a page goes before it asks whether a newer Refresh has landed; Refreshes land
   hours apart, so asking sooner would only hear the same answer */
const STALE_AFTER = 10 * 60_000;

/* A tab left open (a laptop asleep overnight) keeps the page it loaded and goes on saying
   "Refreshed a day ago". When the reader comes back to it (the tab in view again, the
   window focused, the page restored from the back/forward cache) and it was read over
   STALE_AFTER ago, the page asks /api/refreshed for the latest Refresh, and reads itself
   again only when that is newer than `refreshedAt`, the one it shows. Nothing polls
   while a tab stays open. */
export function useLatestRefresh(refreshedAt: Freshness["refreshedAt"]) {
  const router = useRouter();
  useEffect(() => {
    let readAt = Date.now();
    const back = () => {
      if (document.visibilityState !== "visible" || Date.now() - readAt < STALE_AFTER) return;
      readAt = Date.now();
      void fetch("/api/refreshed", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<Pick<Freshness, "refreshedAt">>) : null))
        .then((latest) => {
          if (latest?.refreshedAt && latest.refreshedAt !== refreshedAt) router.refresh();
        })
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", back);
    addEventListener("focus", back);
    addEventListener("pageshow", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      removeEventListener("focus", back);
      removeEventListener("pageshow", back);
    };
  }, [refreshedAt, router]);
}

/* useNow, but with a timer at `at` (an ISO time) as well, so what changes there (a
   Daily's close) changes on time rather than at the next minute */
export function useNowPast(at: string) {
  const now = useNow();
  /* the `at` whose timer has gone off */
  const [passed, setPassed] = useState<string | null>(null);
  useEffect(() => {
    const ms = Date.parse(at) - Date.now();
    if (!(ms > 0 && ms < 2 ** 31)) return;
    const t = setTimeout(() => {
      setPassed(at);
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [at]);
  return now != null && passed === at ? Math.max(now, Date.parse(at)) : now;
}

/* A Daily's clock: the time (useNowPast, so it moves on each minute and at the close
   itself) and whether the Daily is live by it (isLive). A page rendered before the close
   flips to Final at it without a reload. */
export function useDailyClock(d: { endsAt: string; final: boolean }) {
  const now = useNowPast(d.endsAt);
  return { now, live: isLive(d, now) };
}

/* The time an age is counted to: the browser's clock once the page runs, and until then
   `asOf` (when the data was read), so the server render and hydration agree. */
export const useClock = (asOf: number) => useNow() ?? asOf;

/* `value` once it has stayed put for `ms`: what a search box filters by while the reader
   is still typing */
export function useDebounced<T>(value: T, ms = 120): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [value, ms]);
  return settled;
}

export interface Search<T> {
  /* the latest answer, and the search it answers; it stays while a newer one is read */
  last: { key: string; data: T } | null;
  /* the latest read failed, so `last` answers an older search */
  failed: boolean;
  /* the search whose read failed, while `failed` */
  failedFor: string | null;
}

const NO_SEARCH = { last: null, failed: false, failedFor: null };

/* A search read from the server: `read(key)` once `key` has stayed put for `ms`. An answer
   that comes back after the reader has typed something else is dropped, so a slow answer
   never replaces a newer one, and the previous answer stays on screen until the new one
   arrives. An empty key is no search: `ms` after the box is cleared, there is no answer.
   `read` should be stable (module-level or useCallback), or every render reads again. */
export function useDebouncedFetch<T>(
  key: string,
  read: (key: string) => Promise<T>,
  ms = 120,
): Search<T> {
  const [search, setSearch] = useState<Search<T>>(NO_SEARCH);
  /* the search the reader wants now */
  const want = useRef(key);
  useEffect(() => {
    want.current = key;
    const t = setTimeout(() => {
      if (!key) {
        setSearch(NO_SEARCH);
        return;
      }
      read(key).then(
        (data) => {
          if (want.current === key)
            setSearch({ last: { key, data }, failed: false, failedFor: null });
        },
        () => {
          if (want.current === key) setSearch((s) => ({ ...s, failed: true, failedFor: key }));
        },
      );
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [key, read, ms]);
  return search;
}
