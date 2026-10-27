// Who is using the page, and the token every API request carries. Inside Discord it signs in
// through the Embedded App SDK, and `renew` signs in again when the bot turns a token away
// mid-session. No token outlives the page: storage is shared by every Discord account on the
// device, so a kept one could sign the next account in as the last.

/** The parts of the Embedded App SDK sign-in uses (discord.ts adapts the real one). */
export interface DiscordClient {
  /** The server the Activity was opened in; null in a DM. */
  readonly guildId: string | null;
  readonly ready: () => Promise<void>;
  /** Discord's OAuth consent (silent once given): an OAuth code for the bot to swap. */
  readonly authorize: () => Promise<string>;
  /** Tell Discord who the page is acting for; rejects a token it no longer takes. */
  readonly authenticate: (accessToken: string) => Promise<void>;
}

export interface SignedIn {
  /** The Venue's server the page was opened in: every request names it, and the API serves that Venue. */
  readonly guild: string;
  /** The token to send now. */
  readonly token: () => string;
  /**
   * Sign in again after the bot said 401. Requests turned away together share one renewal; it
   * rejects when Discord won't sign the member in.
   */
  readonly renew: () => Promise<void>;
}

/** A session whose token never changes, in one server: the demo's `dev-<id>`. */
export const fixedSession = (token: string, guild: string): SignedIn => ({
  guild,
  token: () => token,
  renew: () => Promise.reject(new Error("the demo's sign-in can't be renewed")),
});

export const discordSession = async (
  discord: DiscordClient,
  deps: {
    /** The servers Multiballs runs in: every running Venue's, home's and each guest's. */
    readonly guildIds: ReadonlyArray<string>;
    /** The bot's /api/token: an OAuth code for an access token. */
    readonly exchange: (code: string) => Promise<string>;
  },
): Promise<SignedIn | "wrongServer"> => {
  await discord.ready();
  const guild = discord.guildId;
  if (guild === null || !deps.guildIds.includes(guild)) return "wrongServer";

  const fresh = async () => {
    const token = await deps.exchange(await discord.authorize());
    await discord.authenticate(token);
    return token;
  };

  let token = await fresh();
  let renewing: Promise<void> | null = null;
  return {
    guild,
    token: () => token,
    renew: () => {
      renewing ??= (async () => {
        try {
          token = await fresh();
        } finally {
          renewing = null;
        }
      })();
      return renewing;
    },
  };
};
