// Who is using the page, and the token every API request carries. Inside Discord it signs in
// through the Embedded App SDK: a token from an earlier visit is tried first (Discord's own
// authorize round trip is the slowest part of opening the Activity), a new one is asked for when
// that fails, and `renew` asks again when the bot turns a token away mid-session.

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

/** Where the last token is kept between visits; never throws (storage can be off). */
export interface SavedToken {
  readonly read: () => string | null;
  readonly write: (token: string | null) => void;
}

export interface SignedIn {
  /** The token to send now. */
  readonly token: () => string;
  /**
   * Sign in again after the bot said 401. Requests turned away together share one renewal; it
   * rejects when Discord won't sign the member in.
   */
  readonly renew: () => Promise<void>;
}

/** A session whose token never changes: the demo's `dev-<id>`. */
export const fixedSession = (token: string): SignedIn => ({
  token: () => token,
  renew: () => Promise.reject(new Error("the demo's sign-in can't be renewed")),
});

export const discordSession = async (
  discord: DiscordClient,
  deps: {
    /** The servers Multiballs runs in. */
    readonly guildIds: ReadonlyArray<string>;
    readonly saved: SavedToken;
    /** The bot's /api/token: an OAuth code for an access token. */
    readonly exchange: (code: string) => Promise<string>;
  },
): Promise<SignedIn | "wrongServer"> => {
  await discord.ready();
  if (discord.guildId === null || !deps.guildIds.includes(discord.guildId)) return "wrongServer";

  const fresh = async () => {
    const token = await deps.exchange(await discord.authorize());
    await discord.authenticate(token);
    deps.saved.write(token);
    return token;
  };
  const reuse = async (token: string) => {
    try {
      await discord.authenticate(token);
      return token;
    } catch {
      deps.saved.write(null);
      return fresh();
    }
  };

  const kept = deps.saved.read();
  let token = kept === null ? await fresh() : await reuse(kept);
  let renewing: Promise<void> | null = null;
  return {
    token: () => token,
    renew: () => {
      renewing ??= (async () => {
        deps.saved.write(null);
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

/** The token in localStorage, or nothing when the browser keeps none. */
export const localToken = (key: string): SavedToken => ({
  read: () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (token) => {
    try {
      if (token === null) localStorage.removeItem(key);
      else localStorage.setItem(key, token);
    } catch {
      // Storage is off: the next visit authorizes again, which still works.
    }
  },
});
