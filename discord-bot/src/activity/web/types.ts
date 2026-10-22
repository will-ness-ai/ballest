// What the page knows about who is looking, as the API sends it (GET /api/me).
import type { ChosenSkin } from "../../ports.js";

/** Who is looking: their Discord id, their Link if they have one, and their Lobby pings. */
export interface Viewer {
  readonly discordId: string;
  readonly link: {
    readonly steamId: string;
    readonly personaName: string;
    readonly skin: ChosenSkin;
  } | null;
  /** Whether they have @Multiplayer ping; null when Discord couldn't say. */
  readonly pings: boolean | null;
}

export interface Me extends Viewer {
  /** The open Invite or live Match they're in, or the Challenge that names them. */
  readonly matchId: string | null;
  /** The ping role as the server names it: "@Multiplayer ping". */
  readonly pingRole: string;
}
