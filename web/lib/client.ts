"use client";
// Small hooks the client components share.
import { useSyncExternalStore } from "react";

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

/* The time an age is counted to: the browser's clock once the page runs, and until then
   `asOf` (when the data was read), so the server render and hydration agree. */
export const useClock = (asOf: number) => useNow() ?? asOf;
