"use client";
// Every player's Chosen Skin (CONTEXT.md), as the picture each marble draws, handed down
// from the root layout so any marble on any page can find its player's (components/Marble).
// Read once per page from the cached map (getChosenSkins in db/data.ts), not in each query
// that draws a player: some draw one from a Steam ID alone. A pick saved in this tab
// (components/player/SkinPicker.tsx) lays over the map, so your marbles draw it at once,
// before any page is read again.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/* Steam ID -> the picture of their Chosen Skin */
export type ChosenSkinMap = Readonly<Record<string, string>>;

/* a pick saved here: its picture, or null for one cleared */
type Saved = Readonly<Record<string, string | null>>;

const Chosen = createContext<{
  map: ChosenSkinMap;
  saved: Saved;
  save: (steamId: string, picture: string | null) => void;
}>({ map: {}, saved: {}, save: () => undefined });

export function ChosenSkins({ value, children }: { value: ChosenSkinMap; children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>({});
  const save = useCallback((steamId: string, picture: string | null) => {
    setSaved((s) => ({ ...s, [steamId]: picture }));
  }, []);
  const ctx = useMemo(() => ({ map: value, saved, save }), [value, saved, save]);
  return <Chosen.Provider value={ctx}>{children}</Chosen.Provider>;
}

/* the picture of `steamId`'s Chosen Skin, or null for a player who picked none */
export function useChosenSkin(steamId: string): string | null {
  const { map, saved } = useContext(Chosen);
  return steamId in saved ? (saved[steamId] ?? null) : (map[steamId] ?? null);
}

/* records a pick just saved, so every marble of that player draws it */
export function useSaveChosenSkin(): (steamId: string, picture: string | null) => void {
  return useContext(Chosen).save;
}
