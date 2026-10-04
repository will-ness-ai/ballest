"use client";
// What the reader has set on a player's Workshop and Made tabs: the Medal filter, the
// search, the sort, how far the list is shown, and whether every Map they made is out.
// It lasts while they move between that player's tabs and starts fresh for each new
// player, as on the single-page site.
import { useEffect, useState } from "react";

export const PW_CHUNK = 40;

export const PW_SORTS = ["best", "rank", "close", "runs", "newest", "az"] as const;
export type PwSort = (typeof PW_SORTS)[number];

export interface PlayerView {
  tier: string | null;
  q: string;
  sort: PwSort;
  shown: number;
  allMade: boolean;
}

const fresh = (): PlayerView => ({
  tier: null,
  q: "",
  sort: "best",
  shown: PW_CHUNK,
  allMade: false,
});

let saved: { id: string; view: PlayerView } | null = null;

export function usePlayerView(id: string) {
  const [view, setView] = useState(() => (saved?.id === id ? saved.view : fresh()));
  useEffect(() => {
    saved = { id, view };
  }, [id, view]);
  return [view, setView] as const;
}
