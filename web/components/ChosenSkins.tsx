"use client";
// Every player's Chosen Skin (CONTEXT.md), as the picture each marble draws, handed down
// from the root layout so any marble on any page can find its player's (components/Marble).
// Read once per page from the cached map (getChosenSkins in db/data.ts), not in each query
// that draws a player: some draw one from a Steam ID alone.
import { createContext, useContext, type ReactNode } from "react";

/* Steam ID -> the picture of their Chosen Skin */
export type ChosenSkinMap = Readonly<Record<string, string>>;

const Chosen = createContext<ChosenSkinMap>({});

export function ChosenSkins({ value, children }: { value: ChosenSkinMap; children: ReactNode }) {
  return <Chosen.Provider value={value}>{children}</Chosen.Provider>;
}

/* the picture of `steamId`'s Chosen Skin, or null for a player who picked none */
export function useChosenSkin(steamId: string): string | null {
  return useContext(Chosen)[steamId] ?? null;
}
