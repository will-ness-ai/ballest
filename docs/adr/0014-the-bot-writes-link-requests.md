# The bot writes link requests to the leaderboard database

Status: accepted (2026-10-22). Amends ADR 0006.

See my stats (spec #323) answers a Discord member privately with their Stat Card, which
needs their Steam ID. The Match bot's Link holds whatever profile a member pasted, unchecked,
so a card drawn from it could show anyone's stats under anyone's name. Will chose the site's
own Sign in with Steam (ADR 0008) as the proof: a Stats Link (CONTEXT.md) is the Steam ID a
Discord account signed in as on the site.

The bot and the site have to agree on which Discord account is signing in. They meet in the
database. A press of See my stats with no Stats Link makes Multiballs write a link request
to `stats_link_requests`: a random 128-bit token, the Discord account's ID and name, and when.
That is the first row the bot writes in the leaderboard database, which ADR 0006 made
read-only for it, and one insert per press is all it writes there (pruning the requests past
their 15 minutes as it does). It sends the member to `/discord/link?t=<token>` on the site.
The site owns everything else: the page, the sign-in, and the confirm, a POST from the page
that, signed in and from the site itself, marks the request used and writes the Stats Link
to `stats_links` in one transaction, so a token pairs once. Multiballs reads `stats_links`
back, and watches its request until it is used, to answer with the card. Both tables belong
to the site's Drizzle schema like every other.

The link page is the one page that reads the session cookie while it draws, so it is never
cached, unlike every other page (ADR 0008). It is a page for one reader, opened once, and
what it says depends on who is signed in. The confirm is a POST and never a GET, so a link
preview (Discord's, or a chat app's) that opens the link can't use the token.

## Considered Options

- An API route on the site that the bot calls to make a request: keeps the bot read-only,
  but the site would need to know the call came from the bot, which is a secret shared
  between Fly and Vercel, one more to set up and rotate. The bot already holds
  `DATABASE_URL` and writes nothing a player can't undo by pairing again.
- A signed token the bot makes and the site checks, with no table: the same shared secret,
  and the bot couldn't tell when the member had signed in, so its answer couldn't turn into
  the card by itself.
- Discord's own Steam connection, or Linked Roles: reads a connection the member may not
  have shown, and needs Discord OAuth on the site, more setup for less proof than a Steam
  sign-in the site already has.
- Store the Stats Link in the bot's SQLite: the site couldn't write it, and the confirm
  happens on the site.
