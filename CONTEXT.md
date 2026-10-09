# Ballest community tools

Tools built around **Ballest of Them All**: a read-only mirror of the game's Steam
leaderboards, and **Multiballs**, an unofficial community Discord bot that runs timed
head-to-head Matches on Workshop maps.

## Language

### Leaderboards

**Map**:
A player-made track published to the Steam Workshop, with its own Steam leaderboard.
_Avoid_: custom map, UGC map, level

**Track**:
One of the game's own courses in its Circuit mode (Season 1 or Season 2).
_Avoid_: campaign, campaign map

**Medal**:
One of a Map's four time targets, Bronze, Silver, Gold and Author (fastest), set by its
creator. A Track has the same four, set by the game. A time earns the best Medal whose target it meets. A player's page sorts their
finishes six ways, best first: World record (rank 1 on the Map's board), Author, Gold,
Silver, Bronze, and No medal. A world record is a rank and a Medal is a time, so they are
counted apart: a record at the author time counts under both, a slower one under its own
Medal.
_Avoid_: tier, grade

**Played**:
A player has Played a Map if they hold a time on that Map's leaderboard. Attempts that
never finished are invisible and do not count. A time can still beat the author time:
that is a Medal, not Played.
_Avoid_: attempted, beaten (for Played)

**You**:
The player signed in with Steam in this browser (ADR 0008). The header's card links to
your page, boards show where you stand, and another player's page scores you against
them. Signed in as a Steam ID on no board counts as no You: the header only offers Sign
out, since that player has no page to sign out from.
_Avoid_: me, current user, logged-in player

**Entry**:
A player's score on one board as Steam holds it: a time on a Map or Track, points on an
Overall board. A board holds at most one Entry per player; a better run replaces it.
_Avoid_: row, record (a record is rank 1), run (for the stored score)

**Refresh**:
One pass of the collector over Steam, at a moment in time. It reads every Track and
Overall board, and only the Maps whose activity moved, so a Map not read in a Refresh
says nothing about that moment.
_Avoid_: run (a player's attempt), sync, scrape

**Score history**:
Every Entry a player has held on a board, each with the first and last Refresh that saw
it. A player's personal-best progression and a board's world-record history are both read
from it. Backfilled from the git history of the old JSON, so its earliest Entries were
first seen no later than their first Refresh, not exactly then.
_Avoid_: snapshots, audit log

**Reign**:
The span one world record stood on a Track or Map board: from the Refresh that first saw it
lead to the one that saw a faster time take it. An equal time does not start a new Reign,
and neither does an Entry Steam removed after one Refresh. A record already there when the
board was first read was set then or earlier. When a holder leaves the board, the record
passes back to the next fastest time, which starts a Reign with no cut.
_Avoid_: streak, hold, tenure

**Daily**:
The game's one-day challenge: one Map, played in a window (`starts_at` to `ends_at`, as
the developers' API gives them) on its own Steam board, apart from the Map's all-time
board. Named by its date. It is live while its window is open, and final once a Refresh
has read its board after the window closed; a Daily's standings count final Dailies only.
_Avoid_: daily challenge board, Daily Report (that is Multiballs' post)

**Daily Report**:
Multiballs' once-a-day post of the Workshop standings (Maps played, Author Medals, world
records, top 5s), what changed since the day before, Maps nobody has finished, unclaimed
Author Medals and the longest-standing records. A creator counts on their own Map only by
beating its Author Medal, since the Author time is their publishing run.
_Avoid_: daily stats, stat report

### Matches

**Player**:
A Discord member who has linked their Steam account to the bot. Only Players can send
or accept Invites.
_Avoid_: user, member

**Link**:
The stored pairing of one Discord account with one Steam account, made by the Player
through the Link Steam button.
_Avoid_: registration, connection

**Invite**:
An open offer to play a Match, with a chosen duration (5–60 minutes) and a Match type.
It expires, and disappears, if not started within five minutes.
_Avoid_: challenge (that is a Match type), request

**Match**:
A timed contest on one Map, starting when its Invite is filled and ending when the
duration runs out, or once every Player has left it: a Player who leaves keeps their best
time so far, and nothing they set afterwards counts. If everyone leaves before anyone set
a time, the Match is cancelled.
_Avoid_: game, race, session

**Public 1v1**:
A Match type whose Invite any Player can accept; the first to accept is the opponent.

**Challenge**:
A Match type whose Invite names one Player, who alone can accept it.
_Avoid_: private 1v1, duel

**Lobby**:
A Match type whose Invite any number of Players can join; it starts when its creator
starts it, even if no one else has joined. Players can still join once it is live; a late
joiner's PB on the Map when they join is the PB they must beat. A Player who left can't rejoin.
_Avoid_: public lobby, room

**Eligible Map**:
A Map whose world record is between 5 seconds and 5 minutes and whose author time is at
most a tenth of the Match's duration. The Match's Map is drawn at random from the ones no
Player in the Match at the draw has Played. When every one tried has been Played, the one
the fewest Players have Played is drawn instead, and each of them counts only with a run
faster than the PB they already held on it; otherwise they finish DNF.
_Avoid_: map pool, candidate

**Match Thread**:
The Discord thread that holds one Match's Invite, joins, start ping and Result, and where
Players talk. The bot's channel itself is read-only for members.

**Match Card**:
The one message in the bot's channel that stands for a Match, edited in place as it moves
from Invite to live to finished; its Match Thread hangs off it.
_Avoid_: status message, embed

**Improvement**:
A Player's first time, or a faster time, on the Match's Map while the Match is live.
Each one is announced in the Match Thread as it happens.
_Avoid_: PB, split, update

**Footer**:
The bot's message at the bottom of its channel, offering New Match, Link Steam and Pings
(the @Multiplayer ping role). The next Match Card is made by editing it, and a fresh Footer
is posted below; a Lobby's Card is posted as a new message instead, so its mention of
@Multiplayer ping notifies, and the old Footer is deleted.
_Avoid_: sticky, pinned message

**Result**:
Each Player's best time on the Match's Map, read the moment the Match ends, ranked. A
Player with no time did not finish. If Steam is down then, the Result waits for it (up to 30
minutes, the thread saying time's up), and failing that stands on the last times polled.
