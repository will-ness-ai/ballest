# Sign in with Steam

Status: accepted (2026-10-08).

You (CONTEXT.md) was first a Steam ID the reader marked with "This is me" on a player's
page and kept in their browser. Anyone could claim anyone, and players found the flow
before they found the button. Will chose to replace it with a real sign-in (2026-10-08).

Sign-in is Steam OpenID 2.0. The site sends the reader to Steam's login page, Steam sends
them back with a signed assertion, and the site checks it by asking Steam itself
(`check_authentication`) rather than holding any key of Steam's. The only thing kept is
the Steam ID from the claimed identity. No Steam Web API key, no profile read, no
database table: names and marbles still come from the boards.

The session is one httpOnly, `SameSite=Lax`, `Secure` cookie holding the Steam ID, the time
it was issued and an HMAC of both under `SESSION_SECRET`, a Vercel environment variable.
A second, readable cookie holds only `1`, so the browser knows a session exists without
asking. Nothing else about the reader is stored anywhere. Sign out clears both.

Pages stay cached (ADR 0004): the server never reads the cookie while drawing a page.
The browser asks `GET /api/me`, which is never cached, only when that cookie is there, for the signed-in Steam ID, and
You's header card, banners and highlights draw from that, as they did from the browser's
claim. Old claims in browsers are ignored.

## Considered Options

- Keep "This is me": no setup, but it can't tell you from anyone who claims your page.
- Discord sign-in: the Match bot already knows Discord accounts, but a Discord account
  doesn't say which Steam ID is yours without a link step. Out of scope for now.
- Read the cookie in the page: every page would render per reader and lose the cache.
- A session table in Postgres: revocation per session, which nothing here needs yet.
