"use client";
// The Workshop's small client pieces: the clock its ages and the week filter read, and the
// back link a Map's page shows, which names the Workshop view the reader came from.
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

import { useNow } from "../../lib/client";
import { homeHref } from "../../lib/routes";
import { ageText } from "../../lib/rules";

/* The time an age is counted to: the browser's clock once the page runs, and until then
   `asOf` (when the data was read), so the server render and hydration agree. */
export const useClock = (asOf: number) => useNow() ?? asOf;

/* how long ago a Map was published, kept current in a cached page */
export function Age({ created, asOf }: { created: number; asOf: number }) {
  return <>{ageText(created, useClock(asOf))}</>;
}

const LIST_KEY = "ballest-ws-list";

const readList = () => {
  try {
    const p = sessionStorage.getItem(LIST_KEY);
    return p && /^\/(maps(\/[a-z]{1,12})?)?$/.test(p) ? p : null;
  } catch {
    return null;
  }
};

/* the homepage and All maps note themselves as the list a Map's page goes back to, for
   this tab's session */
export function RememberList({ path }: { path: string }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(LIST_KEY, path);
    } catch {
      /* no storage: the back link goes to the homepage */
    }
  }, [path]);
  return null;
}

const never = () => () => undefined;

export function BackLink() {
  const to = useSyncExternalStore(never, readList, () => null) ?? homeHref();
  return (
    <Link className="back" href={to}>
      &larr; {to.startsWith("/maps") ? "All maps" : "Workshop"}
    </Link>
  );
}
