<#
  One-shot GitHub setup for the Ballest leaderboard site.

  Run this in YOUR terminal (where `gh` is authenticated). It:
    1. creates the GitHub repo and pushes this project,
    2. sets the STEAM_REFRESH_TOKEN + STEAM_API_KEY Actions secrets
       (read from your local files -- they never appear on the command line),
    3. enables GitHub Pages (deploy from main / root).

  Prereqs (one time):
    winget install --id GitHub.cli        # then open a NEW terminal
    gh auth login                         # pick GitHub.com, HTTPS, login via browser

  Usage (from the project root):
    powershell -ExecutionPolicy Bypass -File tools\setup-github.ps1
    # optional: -RepoName ballest  -Private
#>
param(
  [string]$RepoName = "ballest",
  [switch]$Private
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)   # project root

Write-Host "== Checking gh ==" -ForegroundColor Cyan
try { gh --version | Out-Null } catch {
  throw "GitHub CLI not found. Install: winget install --id GitHub.cli  (then open a new terminal)"
}
$who = (gh api user -q .login 2>$null)
if (-not $who) { throw "gh is not authenticated. Run: gh auth login" }
Write-Host "GitHub user: $who"

Write-Host "== Reading local secrets ==" -ForegroundColor Cyan
$tokenPath = "tools\refresh_token.txt"
if (-not (Test-Path $tokenPath)) { throw "$tokenPath missing. Run: tools\.venv-steampy\Scripts\python.exe tools\steampy_mint.py" }
$token = (Get-Content $tokenPath -Raw).Trim()
if (-not $token) { throw "$tokenPath is empty." }

$apikey = ""
foreach ($line in Get-Content ".env") {
  if ($line -match '^\s*STEAM_API_KEY\s*=\s*(.+?)\s*$') { $apikey = $Matches[1].Trim() }
}
if (-not $apikey) { throw "STEAM_API_KEY not found in .env" }
Write-Host "  refresh token: present ($($token.Length) chars)"
Write-Host "  api key:       present"

Write-Host "== Creating repo + pushing ==" -ForegroundColor Cyan
$vis = if ($Private) { "--private" } else { "--public" }
$exists = $false
try { gh repo view "$who/$RepoName" 1>$null 2>$null; if ($LASTEXITCODE -eq 0) { $exists = $true } } catch {}
if ($exists) {
  Write-Host "  repo $who/$RepoName already exists - pushing current main."
  git remote get-url origin 2>$null; if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$who/$RepoName.git" }
  git push -u origin main
} else {
  # Drop any stale local 'origin' (e.g. left over after deleting a prior repo)
  # so gh can create the remote cleanly.
  git remote remove origin 2>$null | Out-Null
  gh repo create $RepoName $vis --source=. --remote=origin --push
}

Write-Host "== Setting Actions secrets ==" -ForegroundColor Cyan
$token  | gh secret set STEAM_REFRESH_TOKEN --repo "$who/$RepoName"
$apikey | gh secret set STEAM_API_KEY       --repo "$who/$RepoName"
Write-Host "  secrets set."

Write-Host "== Enabling GitHub Pages (main / root) ==" -ForegroundColor Cyan
$body = '{"source":{"branch":"main","path":"/"}}'
$body | gh api -X POST "repos/$who/$RepoName/pages" --input - 2>$null
if ($LASTEXITCODE -ne 0) {
  # Already enabled? Update instead.
  $body | gh api -X PUT "repos/$who/$RepoName/pages" --input - 2>$null | Out-Null
}
Write-Host "  Pages enabled (custom domain comes from the committed CNAME file)."

Write-Host ""
Write-Host "================= NEXT: DNS =================" -ForegroundColor Green
Write-Host "At whoever manages willness.dev DNS, add:"
Write-Host "    Type:  CNAME"
Write-Host "    Name:  ballest"
Write-Host "    Value: $who.github.io"
Write-Host ""
Write-Host "Then: repo Settings -> Pages -> tick 'Enforce HTTPS' once the cert is issued."
Write-Host "Kick a data refresh anytime: repo Actions -> 'Refresh leaderboards' -> Run workflow."
Write-Host "Site will be live at: https://ballest.willness.dev"
