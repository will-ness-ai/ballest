# Desktop apps sign in through the browser

Status: accepted (2026-11-09), for Ballest Editor's Prefabs.

Ballest Editor (spigipple's desktop map editor, Electron) wants to browse, insert and upload
Prefabs like AnythingGoes's plugin does in the game. Reading needs nothing: the gallery's API
is open (ADR 0016). Writing needs a player, and the game's way in, a Steam Web API ticket the
plugin manager makes inside the running game (ADR 0016), isn't open to an app outside it.

So an app signs its player in through their browser, the way native apps do OAuth (RFC 8252,
with PKCE, RFC 7636). It opens `GET /api/auth/app?redirect_uri=&state=&code_challenge=` in
the player's browser, with a `redirect_uri` on the loopback address (`http://127.0.0.1` or
`http://[::1]`, any port and path), a `state` of its own and the SHA-256 of a secret it keeps
(`code_challenge_method=S256`, the only method). The site sends the browser through Steam's
login as it does for the site itself (ADR 0008), with a state cookie of its own, coming back
to `/api/auth/app/return`, and from there to the app's `redirect_uri` with `code` and the app's `state`, or with
`error=access_denied` when the login didn't go through. The app posts the code and its secret
to `POST /api/auth/app/token` and gets `{ id, token, expiresIn }`: an app token, which the
Prefab API's player routes take as `Authorization: Bearer` exactly like the game's token
(`prefabSessionOf`), and nothing else does.

- **The code holds no table.** It is the Steam ID, when it was made and the challenge, signed
  under `SESSION_SECRET`, good for two minutes. It can be traded more than once in that time,
  but only by whoever holds the secret behind its challenge, which never leaves the app, so a
  code seen in a browser's history or a log is useless. That keeps the site free of a
  migration and its preview working.
- **No Allow page.** The code goes only to the player's own machine, so a link sent to a
  player can't hand anyone else their token; a page asking "Allow Ballest Editor?" would guard
  only against another program on that machine, which can do worse than upload a Prefab.
- **The app token is its own kind** (`id.issued.app`), never passed as the game's or the
  browser's, and lives 30 days: the game signs in again silently each start, but an app's
  sign-in is a trip through the browser.
- **S256 is the default method.** RFC 7636 reads a missing `code_challenge_method` as `plain`,
  but nothing else is taken, so a request without one is read as S256: a plain challenge
  could never match a verifier's hash anyway.
- **Its own state cookie** (`ballest-signin-app`), so a sign-in to the site in another tab
  doesn't spend the app's, and the other way round.
- **The trade counts against the game's sign-in limit** (30 an hour per address, 2,000 in all,
  `db/game-sign-in.ts`), so a loop of codes can't spend more than tickets can. As with tickets,
  only a trade shaped like one is counted, and the count comes before the code is checked.

## Considered Options

- The editor's own plugin asks the plugin manager for a ticket and passes it out through a
  file: no new routes, but uploading would need the game running, and the plugin manager
  makes tickets out per plugin, so the site would take a second identity.
- Steamworks inside the app with the game's app ID: Steam shows the player as in the game,
  and it clashes with the game itself running.
- A token made on the site and pasted into the app: turned down in ADR 0016, for the same
  reasons (one more secret for players to copy and leak).
- A table of single-use codes: a replay guard the challenge already gives, at the price of a
  migration.
