# Installs ValvePython/steam into YOUR Python and runs the leaderboard prover.
# Does NOT need admin. If anonymous login can't read the board, the prover will
# prompt YOU for your Steam login in this console (your password goes only to Steam).
$ErrorActionPreference = "Continue"

$Py = "C:\Users\Will\AppData\Local\Programs\Python\Python310\python.exe"
if (-not (Test-Path $Py)) { $Py = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $Py) { Write-Host "Python not found." -ForegroundColor Red; exit 1 }
Write-Host "Using Python: $Py" -ForegroundColor Cyan

# ensure the steam client library is present
& $Py -c "import steam.client" 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing steam[client] (one-time)..." -ForegroundColor Cyan
    & $Py -m pip install --user "steam[client]"
}
& $Py -c "import steam.client" 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "Install failed. Try: $Py -m pip install --user `"steam[client]`"" -ForegroundColor Red; exit 1 }

Write-Host "Running prover..." -ForegroundColor Green
Write-Host ""
& $Py "C:\Users\Will\Documents\Projects\Ballest\tools\steam_prover.py"
