"use client";
// "Where I came from", kept for this tab's session, and the back link that leads there.
// Two trails: a player's page goes back to the board the reader last looked at (a Circuit
// board renders <Remember trail="board">), and a Map's page to the Workshop list they came
// from (the homepage and All maps render <Remember trail="maps">). With nothing kept, or
// storage blocked, a link falls back to every leaderboard or the Workshop homepage. Only a
// path on this site ever comes back out, so a stored value can't send the link elsewhere.
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";

import { never } from "../hooks/client";
import { homeHref } from "../lib/routes";

interface Back {
  href: string;
  label: string;
}

const listLabel = (href: string) => (href.startsWith("/maps") ? "All maps" : "Workshop");

/* each trail's storage key, what it stores, and what it reads back (null: not ours) */
const TRAILS = {
  board: {
    key: "ballest-board",
    fallback: { href: homeHref(), label: "All leaderboards" },
    write: (b: Back) => JSON.stringify(b),
    read(raw: string): Back | null {
      try {
        const b = JSON.parse(raw) as Partial<Back>;
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
    },
  },
  /* the homepage or one of All maps' views, kept as its path */
  maps: {
    key: "ballest-ws-list",
    fallback: { href: homeHref(), label: listLabel(homeHref()) },
    write: (b: Back) => b.href,
    read: (raw: string): Back | null =>
      /^\/(maps(\/[a-z]{1,12})?)?$/.test(raw) ? { href: raw, label: listLabel(raw) } : null,
  },
} as const;

export type Trail = keyof typeof TRAILS;

/* note this page as where `trail`'s back link leads: a board by its name, a Workshop list
   by its path alone (it names itself) */
export function Remember({
  trail,
  href,
  label = "",
}: {
  trail: Trail;
  href: string;
  label?: string;
}) {
  const t = TRAILS[trail];
  const value = t.write({ href, label });
  useEffect(() => {
    try {
      sessionStorage.setItem(t.key, value);
    } catch {
      /* storage blocked: the back link falls back */
    }
  }, [t, value]);
  return null;
}

const stored = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

/* "← <where they came from>": the fallback on the server, in hydration, or with nothing
   kept. A page that always leads back to one place passes it instead of a trail. */
export function BackLink(props: { trail: Trail } | Back) {
  const t = "trail" in props ? TRAILS[props.trail] : null;
  const raw = useSyncExternalStore(
    never,
    () => (t ? stored(t.key) : ""),
    () => "",
  );
  const b = t ? (t.read(raw) ?? t.fallback) : (props as Back);
  return (
    <Link className="back" href={b.href}>
      &larr; {b.label}
    </Link>
  );
}
