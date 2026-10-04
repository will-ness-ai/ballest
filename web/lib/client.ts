"use client";
// Small hooks the client components share.
import { useSyncExternalStore } from "react";

const never = () => () => undefined;

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
