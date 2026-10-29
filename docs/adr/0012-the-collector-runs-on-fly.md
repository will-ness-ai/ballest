# The collector runs on Fly

Status: accepted (2026-10-18). Its jobs as child processes, each with its own Steam login, are superseded by ADR 0015.

GitHub Actions ran the Refresh from a `0 */3 * * *` cron, and the jobs around it as their own
workflows: the Map file backlog by hand, and adding a #new-tracks post's Maps when Multiballs
dispatched it. Two things wore on that. GitHub started the cron three to five times a day,
often an hour or more late, so Refreshes landed four to six hours apart and the site's copy
had to apologise for it. And every job that logs into Steam uses the same account, where a
second login drops the first, so each workflow had to look for the others before logging in
(`gh run list` inside a job), with gaps that check could not close: a Refresh starting during
a file download ended the download's session.

The collector now runs as one always-on process on Fly.io, `tools/runner.py` in its own app,
`ballest-collector`, in the same org and region as Multiballs. It starts the Refresh on the
hour every three hours, and every job that logs into Steam takes its turn on one lock in that
process, so two logins can't happen. Each job is still the same script run as its own child
process, as a workflow step ran it, so the collector's code and its tests did not change.
Multiballs reaches the service over Fly's private network (`POST /add-maps`), so it needs
no GitHub token to start a job. The service has no public address and takes no secret. A failed
Refresh or Map add posts its last lines to the private ops channel, in place of Actions'
failure emails, and the logs are `fly logs`.

It costs one shared-cpu-1x machine kept running, a few dollars a month (priced in the PR that
made it). Actions keeps the jobs that are rare and run by hand: the backfill (ADR 0005),
migrations, and `refresh.yml` as a fallback while the service is down. The 3D-file backlog moved
into the service with the rest, since it logs into Steam for up to an hour; it stops starting
downloads shortly before each slot, so the Refresh still starts on the hour.

## Considered Options

- Keep Actions and live with the late cron: free, with run history and a re-run button, but
  the lateness and the cross-workflow login checks were the problem.
- Run it inside Multiballs: one machine fewer, but the bot's app is a Node image pinned to one
  volume, it uses its own Steam account so it shares no login with the collector, and a
  collector bug or memory spike would take the bot down with it.
- Fly's scheduled machines: they offer hourly, daily, weekly or monthly, not every three
  hours, and a stopped machine could not take Multiballs' requests or hold the Steam lock
  between jobs.
