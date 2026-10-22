// The Embedded App SDK as sign-in needs it (session.ts's DiscordClient).
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import type { DiscordClient } from "./session.js";

/** What the bot's /api/token answered. */
const swapped = async (res: Response) => {
  if (!res.ok) throw new Error(`the bot answered ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
};

export const discordClient = (sdk: DiscordSDK, clientId: string): DiscordClient => ({
  get guildId() {
    return sdk.guildId;
  },
  ready: () => sdk.ready(),
  authorize: async () => {
    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "rpc.activities.write"],
    });
    return code;
  },
  authenticate: async (access_token) => {
    await sdk.commands.authenticate({ access_token });
  },
});

/** The bot's /api/token: the OAuth code for an access token (it holds the client secret). */
export const exchange = async (code: string) =>
  swapped(
    await fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
