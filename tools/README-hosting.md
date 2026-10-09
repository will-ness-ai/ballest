# Hosting Ballest leaderboards on `ballestrecords.com`

The site is the Next.js app in `web/`, served by **Vercel** (ADR 0004) and reading a
Postgres database on Neon (ADR 0005). The data is refreshed by a **GitHub Actions** job
that logs into Steam with a **refresh token** (via `steam.py`), reads the full
leaderboards, writes them to the database, commits the JSON under `data/`, and tells the
site to read fresh (`POST /api/revalidate`). The site's pages are cached until then.

No machine of yours has to be running — the refresh happens entirely in CI.

```
GitHub Actions (every 3 hours)
  └─ steam.py logs in with STEAM_REFRESH_TOKEN (secret)
      └─ reads every campaign leaderboard (full) for appid 3339810
          └─ resolves names via STEAM_API_KEY (secret)
              └─ writes the Refresh to Postgres, commits data/
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

### 6. Populate the data

Repo → **Actions → "Refresh leaderboards" → Run workflow**. It logs in, writes the Refresh
to the database, commits `data/`, and revalidates the site, which shows it at
`https://ballestrecords.com` on the next request.

---

## Ongoing

- The cron in `.github/workflows/refresh.yml` runs **every 3 hours**. Change the
  `cron:` line to adjust cadence, or trigger manually anytime via **Run workflow**.
- To change which boards appear, edit `tools/campaign_common.py` (`BOARDS`).
- If a refresh fails with a login/token error, re-mint (step 1) and update the
  `STEAM_REFRESH_TOKEN` secret.

## Local testing (optional)

Run the exact CI collector locally against your token:

```powershell
$env:STEAM_REFRESH_TOKEN = (Get-Content tools\refresh_token.txt)
tools\.venv-steampy\Scripts\python.exe tools\steampy_collect.py
```

From a feature branch, add `--out scratch/data` and check the copy with
`python tools/check_data.py --data scratch/data`: the run reads and writes a fresh copy of
`data/`, and the committed data stays as it is. `--workshop-only` reads only the Workshop
Maps, and rebuilds the player shards from them and the committed Circuit boards.

Then preview the site with any static server, e.g.
`python -m http.server 8765` and open <http://localhost:8765>.

## Notes

- `tools/steam_collect.py` (the Steamworks-SDK collector) is the **legacy/local**
  path — it needs the Steam client running and writes the older single
  `data/campaign.json`. The CI path uses `steampy_collect.py`, which does the full
  scrape and writes `data/index.json` + `data/boards/*.json`.
- `steam.py` is pinned with `aiohttp<3.13` (newer aiohttp removed a symbol it imports).
