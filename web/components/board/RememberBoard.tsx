"use client";
// The board the reader last looked at, kept for this tab's session, so a player's page's
// back link can name it ("← 05 Downhill") and lead back to it. A board's page (Circuit or
// a Map's) renders <RememberBoard>; the back link reads it with useRememberedBoard.
import { useEffect, useSyncExternalStore } from "react";

import { homeHref } from "../../lib/routes";

const KEY = "ballest-board";

export interface BoardLink {
  href: string;
  label: string;
}

export const NO_BOARD: BoardLink = { href: homeHref(), label: "All leaderboards" };

export function RememberBoard({ href, label }: BoardLink) {
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ href, label }));
    } catch {
      /* storage blocked: the back link falls back to every leaderboard */
    }
  }, [href, label]);
  return null;
}

/* only a path on this site comes back out, so a stored value can't send the link elsewhere */
function read(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
const never = () => () => undefined;

/* the remembered board, or every leaderboard on the server, in hydration, or with none */
export function useRememberedBoard(): BoardLink {
  const raw = useSyncExternalStore(never, read, () => "");
  if (!raw) return NO_BOARD;
  try {
    const b = JSON.parse(raw) as Partial<BoardLink>;
    if (
      typeof b.href === "string" &&
      b.href.startsWith("/") &&
      !b.href.startsWith("//") &&
      typeof b.label === "string" &&
      b.label
    )
      return { href: b.href, label: b.label };
  } catch {
    /* not ours */
  }
  return NO_BOARD;
}
