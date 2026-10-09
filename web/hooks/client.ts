"use client";
// Small hooks the client components share.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isLive } from "../lib/daily";

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
   would freeze it, then the browser's clock, moving on every minute. */
let now = 0;
function tick(changed: () => void) {
  now = Date.now();
  const t = setInterval(() => {
    now = Date.now();
    changed();
  }, 60_000);
  return () => {
    clearInterval(t);
  };
}
export const useNow = () =>
  useSyncExternalStore(
    tick,
    () => now || (now = Date.now()),
    () => null,
  );

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
}

const NO_SEARCH = { last: null, failed: false };

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
          if (want.current === key) setSearch({ last: { key, data }, failed: false });
        },
        () => {
          if (want.current === key) setSearch((s) => ({ ...s, failed: true }));
        },
      );
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [key, read, ms]);
  return search;
}
