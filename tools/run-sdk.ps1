# Reads a Ballest leaderboard via the Steamworks SDK using your logged-in Steam client.
# No password, no 2FA. Requirements:
#   - Steam client running and logged in (as the account that owns Ballest)
#   - Ballest CLOSED (so there aren't two SteamAPI sessions for the same appid)
# No admin needed.
$ErrorActionPreference = "Continue"

$Proj  = "C:\Users\Will\Documents\Projects\Ballest"
$Tools = "$Proj\tools"
$Dll   = "C:\Program Files (x86)\Steam\steamapps\common\Ballest of Them All\Ballest\Plugins\Dev_SteamIntegrationKit\Source\SteamSdk\redistributable_bin\win64\steam_api64.dll"

$Py = "C:\Users\Will\AppData\Local\Programs\Python\Python310\python.exe"
if (-not (Test-Path $Py)) { $Py = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $Py) { Write-Host "Python not found." -ForegroundColor Red; exit 1 }

# copy the SDK dll next to our reader
if (-not (Test-Path $Dll)) { Write-Host "steam_api64.dll not found at:`n$Dll" -ForegroundColor Red; exit 1 }
Copy-Item $Dll "$Tools\steam_api64.dll" -Force
Set-Content -Path "$Tools\steam_appid.txt" -Value "3339810" -Encoding ASCII -NoNewline

# warn if the game is running
if (Get-Process "Ballest-Win64-Shipping" -ErrorAction SilentlyContinue) {
    Write-Host "WARNING: Ballest is running. Close it first, then re-run this." -ForegroundColor Yellow
    exit 1
}

Write-Host "Running SDK reader (cwd = $Tools)..." -ForegroundColor Green
Write-Host ""
Push-Location $Tools
& $Py "$Tools\steam_sdk_reader.py" $args
Pop-Location
