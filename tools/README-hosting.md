# Hosting Ballest leaderboards on `ballestrecords.com`

The site is the Next.js app in `web/`, served by **Vercel** (ADR 0004) and reading a
Postgres database on Neon (ADR 0005). The data is refreshed by the collector's service on
**Fly.io** (`tools/runner.py`, app `ballest-collector`, ADR 0012), which logs into Steam with a
**refresh token** (via `steam.py`), reads the full leaderboards, writes them to the database,
and tells the site to read fresh (`POST /api/revalidate`). The site's pages are cached until then.

No machine of yours has to be running: the refresh happens entirely on Fly.

```
runner.py on Fly (every 3 hours, on the hour UTC)
  └─ steam.py logs in with STEAM_REFRESH_TOKEN (secret)
      └─ reads every campaign leaderboard (full) for appid 3339810
          └─ resolves names via STEAM_API_KEY (secret)
              └─ writes the Refresh to Postgres
                  └─ POST /api/revalidate  ──►  ballestrecords.com reads fresh
```

---

## One-time setup

### 1. Mint your Steam refresh token (local, ~1 minute)

The token lets CI log in as you without a password. You mint it once, locally,
typing your own password + Steam Guard code (Claude never sees them).

From the project root:

```powershell
tools\.venv-steampy\Scripts\python.exe tools\steampy_mint.py
```

- Enter your Steam **username**, then **password** (hidden).
- When you see `>>>`, type your **Steam Guard code**.
- It prints your **refresh token** (also saved to `tools/refresh_token.txt`, gitignored)
  and then validates by reading the top 5 of the Season 2 Overall board.
- If you see `✓ SUCCESS`, the whole pipeline works. Copy the token.

> The token is long-lived. Re-run this only if CI later reports it expired.

### 2. Create the GitHub repo and push

The repo is public (ADR 0001).

```powershell
# from the project root (git is already initialized with a first commit)
git branch -M main
git remote add origin https://github.com/<you>/ballest.git
git push -u origin main
```

### 3. Add the two secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name                  | Value                                       |
| --------------------- | ------------------------------------------- |
| `STEAM_REFRESH_TOKEN` | the token from step 1                       |
| `STEAM_API_KEY`       | your Steam Web API key (same one in `.env`) |

### 4. Create the Vercel project

Import the repo in Vercel (or `vercel link` with the CLI) as project `ballest`, with
**Root Directory** `web`, "Include files outside the Root Directory" on, and Node 22.x.
Everything else comes from `web/vercel.json`. Production is `main`.

### 5. Point DNS

Add `ballestrecords.com` to the project (`vercel domains add ballestrecords.com ballest`)
and `www.ballestrecords.com` as a 308 redirect to it. The domain is registered at Porkbun
(bought 2026-10-08), so its DNS is set there by hand: delete Porkbun's parking records
(anything pointing at `uixie.porkbun.com` or `pixie.porkbun.com`), then add the records
Vercel's domain config asks for:

```
Type: A      Host: (blank)  Answer: 216.198.79.1
Type: A      Host: (blank)  Answer: 64.29.17.1
Type: CNAME  Host: www      Answer: <the project's target, e.g. ….vercel-dns-017.com>
```

The old address, `ballest.willness.dev`, stays on the project as a 308 redirect to the new
one so links already shared keep working; it is still a CNAME at Porkbun (where
`willness.dev` lives) to the same project target.

Vercel issues the certificates once the records resolve.

### 6. Start the collector on Fly

From `tools/`, with `flyctl` logged in to the org that holds Multiballs (its private network is
how the bot reaches the service):

```bash
fly apps create ballest-collector
fly secrets set -a ballest-collector --stage DATABASE_URL=... STEAM_REFRESH_TOKEN=... \
  STEAM_API_KEY=... BALLEST_API_KEY=... BALLEST_DAILY_URL=... REVALIDATE_SECRET=... OPS_WEBHOOK_URL=...
fly deploy --ha=false
fly tokens create deploy -a ballest-collector   # the GitHub secret FLY_COLLECTOR_TOKEN
```

Its first start finds no Refresh since the last slot and runs one at once: it logs in, writes
the Refresh to the database, and revalidates the site, which shows it at
`https://ballestrecords.com` on the next request. From then on `collector.yml` deploys it.

---

## Ongoing

- The service runs a Refresh **every 3 hours** (`SLOT_HOURS` in `tools/runner.py`)
  and at 01:05 UTC, just after the Daily opens (`DAILY_SLOT`). Run one
  now with `fly ssh console -a ballest-collector -C "python /app/runner.py ask refresh"` and follow
  it with `fly logs -a ballest-collector`. `.github/workflows/refresh.yml` runs one by hand,
  only while the Fly service is down (two Steam logins on one account drop each other).
- To change which boards appear, edit `tools/campaign_common.py` (`BOARDS`).
- If a refresh fails with a login/token error, re-mint (step 1) and update the
  `STEAM_REFRESH_TOKEN` secret on Fly (`fly secrets set -a ballest-collector ...`) and in
  GitHub.

## Local testing (optional)

Run the CI collector locally against your token and a local database (never production;
`CLAUDE.md` has how to make one):

```powershell
$env:STEAM_REFRESH_TOKEN = (Get-Content tools\refresh_token.txt)
$env:DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/ballest_dev"
tools\.venv-steampy\Scripts\python.exe tools\steampy_collect.py --dev
```

Then run the site against that database (`pnpm dev` in `web/`).

## Notes

- `tools/steam_collect.py` (the Steamworks-SDK collector) is the **legacy/local**
  path — it needs the Steam client running and writes the older single
  `data/campaign.json`. The CI path uses `steampy_collect.py`, which does the full
  scrape and writes the database.
- `steam.py` is pinned with `aiohttp<3.13` (newer aiohttp removed a symbol it imports).
