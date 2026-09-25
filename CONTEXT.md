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
One of the game's own campaign courses (Season 1 or Season 2).
_Avoid_: campaign map

**Medal**:
One of a Map's four time targets, Bronze, Silver, Gold and Author (fastest), set by its
creator. A time earns the best Medal whose target it meets.
_Avoid_: tier, grade

**Played**:
A player has Played a Map if they hold a time on that Map's leaderboard. Attempts that
never finished are invisible and do not count.
_Avoid_: attempted, beaten

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
duration runs out.
_Avoid_: game, race, session

**Public 1v1**:
A Match type whose Invite any Player can accept; the first to accept is the opponent.

**Challenge**:
A Match type whose Invite names one Player, who alone can accept it.
_Avoid_: private 1v1, duel

**Lobby**:
A Match type whose Invite any number of Players can join; it starts when its creator
starts it, with at least two Players.
_Avoid_: public lobby, room

**Eligible Map**:
A Map that no Player in the Match has Played, whose world record is between 5 seconds
and 5 minutes, and whose author time is at most a tenth of the Match's duration. The
Match's Map is drawn at random from these.
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
The bot's message at the bottom of its channel, offering New Match and Link Steam. The
next Match Card is made by editing it, and a fresh Footer is posted below.
_Avoid_: sticky, pinned message

**Result**:
Each Player's best time on the Match's Map, read the moment the Match ends, ranked. A
Player with no time did not finish.
