# Hosting Ballest leaderboards on `ballest.willness.dev`

The site is **static** (`index.html` + `data/campaign.json`), served by **GitHub Pages**.
The data is refreshed by a **GitHub Actions** job that logs into Steam with a
**refresh token** (via `steam.py`), reads the leaderboards, and commits an updated
`data/campaign.json`. Pages redeploys automatically on that commit.

No machine of yours has to be running — the refresh happens entirely in CI.

```
GitHub Actions (daily cron)
  └─ steam.py logs in with STEAM_REFRESH_TOKEN (secret)
      └─ reads leaderboards for appid 3339810
          └─ resolves names via STEAM_API_KEY (secret)
              └─ commits data/campaign.json  ──►  GitHub Pages redeploys
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
`data/campaign.json`, and commits it. The site goes live at
`https://ballest.willness.dev` shortly after.

---

## Ongoing

- The cron in `.github/workflows/refresh.yml` runs **daily at 09:00 UTC**. Change the
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

## Notes

- `tools/steam_collect.py` (the Steamworks-SDK collector) is the **legacy/local**
  path — it needs the Steam client running. The CI path uses `steampy_collect.py`
  instead; both write the identical `data/campaign.json` schema.
- `steam.py` is pinned with `aiohttp<3.13` (newer aiohttp removed a symbol it imports).
