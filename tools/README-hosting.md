# Hosting Ballest leaderboards on `ballest.willness.dev`

The site is **static** (`index.html` + `data/index.json` + `data/boards/*.json`),
served by **GitHub Pages**. The page loads the small `index.json` first, then lazy-
loads each board's full entry list on demand (infinite scroll). The data is refreshed
by a **GitHub Actions** job that logs into Steam with a **refresh token** (via
`steam.py`), reads the full leaderboards, and commits the updated data. Pages
redeploys automatically on that commit.

No machine of yours has to be running — the refresh happens entirely in CI.

```
GitHub Actions (every 3 hours)
  └─ steam.py logs in with STEAM_REFRESH_TOKEN (secret)
      └─ reads every campaign leaderboard (full) for appid 3339810
          └─ resolves names via STEAM_API_KEY (secret)
              └─ commits data/index.json + data/boards/*.json  ──►  Pages redeploys
                                                                     (ballest.willness.dev)
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

Pages is free for **public** repos.

```powershell
# from the project root (git is already initialized with a first commit)
git branch -M main
git remote add origin https://github.com/<you>/ballest.git
git push -u origin main
```

### 3. Add the two secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `STEAM_REFRESH_TOKEN` | the token from step 1 |
| `STEAM_API_KEY` | your Steam Web API key (same one in `.env`) |

### 4. Enable GitHub Pages

Repo → **Settings → Pages**:
- **Source:** Deploy from a branch
- **Branch:** `main`  /  **Folder:** `/ (root)`
- **Custom domain:** `ballest.willness.dev` → Save (the committed `CNAME` file matches this)
- Tick **Enforce HTTPS** once the cert is issued.

### 5. Point DNS

At whoever manages `willness.dev` DNS, add:

```
Type: CNAME
Name: ballest
Value: <you>.github.io
```

(Proxy/`CNAME` flattening is fine. Allow a few minutes for propagation + cert.)

### 6. Populate the data

Repo → **Actions → "Refresh leaderboards" → Run workflow**. It logs in, writes
`data/index.json` + `data/boards/*.json`, and commits them. The site goes live at
`https://ballest.willness.dev` shortly after.

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

Then preview the site with any static server, e.g.
`python -m http.server 8765` and open <http://localhost:8765>.

## Discord custom-map standings (local, on demand)

`tools/ugc_discord_leaderboard.py` lists every Workshop map, reads each map's Steam
leaderboard by name, and prints a Discord-ready post: who has beaten the most custom
maps, who holds the most author medals, and (with a Workshop link per map) which maps
are still unbeaten and which author medals are still unclaimed. It needs the same two credentials as the
collector and reads them from `tools/refresh_token.txt` and `.env` by itself:

```powershell
tools/.venv-steampy/Scripts/python.exe tools/ugc_discord_leaderboard.py --out post.md
```

Paste `post.md` into Discord, then `post-2.md` as a second message (the post is split
wherever it would pass Discord's 2000-character limit). `--top N` sets rows per board
(default 10); `--json FILE` dumps the per-player and per-map numbers behind the post.
A creator counts on their own map only by beating their own author time, since the
author time is their publishing run. A full run takes about two minutes.

## Notes

- `tools/steam_collect.py` (the Steamworks-SDK collector) is the **legacy/local**
  path — it needs the Steam client running and writes the older single
  `data/campaign.json`. The CI path uses `steampy_collect.py`, which does the full
  scrape and writes `data/index.json` + `data/boards/*.json`.
- `steam.py` is pinned with `aiohttp<3.13` (newer aiohttp removed a symbol it imports).
