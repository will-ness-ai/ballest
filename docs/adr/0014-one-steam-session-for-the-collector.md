# One Steam session for the collector

Status: accepted (2026-10-20).

ADR 0012 put every collector job in one service on Fly, but each job still ran as its own
child process with its own Steam login, and the jobs took turns on a lock because a second
login on the account drops the first. That held while the jobs were rare. The Daily watcher
(#289) changed it: it reads the open Dailies every minute, so it had to log off whenever a
Refresh or a file download wanted Steam and log in again after, ten to fifteen logins a day,
and the Daily pages stood still for the whole of an hour-long file backlog.

The service now holds one Steam session (`tools/steam_session.py`) and runs every job inside
its own process on it: the Refresh, the file downloads, the Map add and the Daily read are
async functions, not scripts. It logs in when a job first needs Steam and stays logged in;
steam.py reconnects a dropped connection by itself, and a login that fails is tried again a
minute later, with one ops alert. The session sends every request to the CM one at a time, a
leaderboard read's and a file download's alike (the CM drops replies with several in flight),
each with a timeout, so a Daily read slots in
between a Refresh's board reads, and a request lost with its connection fails its job instead
of hanging it. The Daily read skips a minute only while a Refresh runs, since the Refresh
writes the Dailies itself. The Refresh and the file downloads still take turns, so two never
download one Map's file at once. Each job's output still reaches `fly logs` under its name,
and its last lines still reach the ops alert. Each script still runs on its own, logging in
for that run, for local `--dev` runs and `refresh.yml`'s fallback.

The cost is isolation: a job can no longer be killed outright, only cancelled. A database
write already in its thread runs to its end, so a job stopped mid-write holds its turn until
the write is done (`db_writer.record`), and a job that leaks memory or blocks the event loop
slows every job. The jobs run everything blocking in threads (as the Refresh already
did, to keep steam.py's heartbeat), and a full-sweep Refresh's ~260 MB fits the 512 MB
machine as it did as a child.

## Considered Options

- Keep the child processes, with the Daily watcher logging off for each job (#289 as built):
  no rewrite, but a login per job, and the Daily pages stall through every backlog.
- A login broker process that the scripts call over a local socket: keeps the process
  isolation, but every leaderboard and content request would need its own wire format, for
  one machine running one app.
- Read the Dailies with a second Steam account: no shared login at all, but a second account
  to keep and a refresh token to mint for it, and the Refresh and downloads would still take
  turns.
