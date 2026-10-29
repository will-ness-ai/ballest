// The bot's data as the page caches it (TanStack Query): what each query is called, and the
// client every component asks through.
import { createContext, useContext } from "react";
import type { Client } from "./client.js";

/** How often the page asks for the board; the bot itself reads Steam every ten seconds. */
export const POLL_MS = 2_000;

export const keys = {
  board: ["board"] as const,
  match: (id: string | null) => ["match", id] as const,
  players: ["players"] as const,
  pb: (id: string) => ["pb", id] as const,
};

const ClientContext = createContext<Client | null>(null);
export const ClientProvider = ClientContext.Provider;

export const useClient = () => {
  const c = useContext(ClientContext);
  if (c === null) throw new Error("useClient outside ClientProvider");
  return c;
};
