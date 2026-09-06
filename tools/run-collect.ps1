# Collects all campaign leaderboards into data\campaign.json.
# Requirements: Steam running + logged in (owns Ballest), Ballest CLOSED. No admin.
$ErrorActionPreference = "Continue"
$Proj  = "C:\Users\Will\Documents\Projects\Ballest"
$Tools = "$Proj\tools"
$Dll   = "C:\Program Files (x86)\Steam\steamapps\common\Ballest of Them All\Ballest\Plugins\Dev_SteamIntegrationKit\Source\SteamSdk\redistributable_bin\win64\steam_api64.dll"
$Py = "C:\Users\Will\AppData\Local\Programs\Python\Python310\python.exe"
if (-not (Test-Path $Py)) { $Py = (Get-Command python -ErrorAction SilentlyContinue).Source }

if (Get-Process "Ballest-Win64-Shipping" -ErrorAction SilentlyContinue) {
    Write-Host "Close Ballest first (Steam can stay open), then re-run." -ForegroundColor Yellow; exit 1
}
Copy-Item $Dll "$Tools\steam_api64.dll" -Force
Set-Content -Path "$Tools\steam_appid.txt" -Value "3339810" -Encoding ASCII -NoNewline

Push-Location $Tools
& $Py "$Tools\steam_collect.py"
Pop-Location
