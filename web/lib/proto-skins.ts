// PROTOTYPE (ball skins from replays): the skin each player's run wore, read from the
// top 50 ghosts of 26 boards on 2026-10-04 (branch claude/prototype-entry-data), mapped to
// the game's skin assets by their skinMaterial. Not for main.
import catalogue from "./proto-skin-catalogue.json";
import skins from "./proto-skins.json";

const byBoard = skins as Partial<Record<string, Partial<Record<string, string>>>>;

export const SKINS = catalogue as Record<
  string,
  { name: string; group: string; note: string | null }
>;

export function skinFor(board: string, steamId: string): string | undefined {
  return byBoard[board]?.[steamId];
}
