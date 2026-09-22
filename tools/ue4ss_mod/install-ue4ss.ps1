# Installs UE4SS into Ballest with the BallestGrindStats mod, or updates the mod
# if UE4SS is already there. See README.md for what to download first.
# Uninstall: delete Win64\dwmapi.dll and Win64\ue4ss\.
param(
    [string]$Zip = "$env:TEMP\ue4ss.zip",
    [string]$Win64 = "C:\Program Files (x86)\Steam\steamapps\common\Ballest of Them All\Ballest\Binaries\Win64"
)
$ErrorActionPreference = "Stop"
$mod = "$PSScriptRoot\BallestGrindStats"

if (-not (Test-Path "$Win64\ue4ss\UE4SS.dll")) {
    if (-not (Test-Path $Zip)) { throw "UE4SS zip not found at $Zip (see README.md)" }
    # Extract inside the game folder: Defender's heuristic flags the proxy dwmapi.dll,
    # and only an exclusion on this folder keeps it alive.
    $tmp = "$Win64\_ue4ss_unpack"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive $Zip -DestinationPath $tmp
    Move-Item "$tmp\dwmapi.dll" "$Win64\dwmapi.dll" -Force
    if (Test-Path "$Win64\ue4ss") { Remove-Item -Recurse -Force "$Win64\ue4ss" }   # a half-installed leftover
    Move-Item "$tmp\ue4ss" "$Win64\ue4ss"
    Remove-Item -Recurse -Force $tmp

    # Only Keybinds (required) and our mod run; the bundled cheat/console mods stay off.
    $mt = "$Win64\ue4ss\Mods\mods.txt"
    $lines = (Get-Content $mt) -replace '^(CheatManagerEnablerMod|ConsoleCommandsMod|ConsoleEnablerMod|BPML_GenericFunctions|BPModLoaderMod) : 1', '$1 : 0'
    Set-Content $mt (@("BallestGrindStats : 1") + $lines) -Encoding ascii
    Remove-Item "$Win64\ue4ss\Mods\mods.json" -ErrorAction SilentlyContinue   # would override mods.txt

    # Ctrl+R in-game reloads the Lua, so the mod can be edited without relaunching
    $ini = "$Win64\ue4ss\UE4SS-settings.ini"
    (Get-Content $ini) -replace '^EnableHotReloadSystem = 0', 'EnableHotReloadSystem = 1' | Set-Content $ini -Encoding ascii
}

New-Item -ItemType Directory -Force "$Win64\ue4ss\Mods\BallestGrindStats\Scripts" | Out-Null
Copy-Item "$mod\Scripts\*.lua" "$Win64\ue4ss\Mods\BallestGrindStats\Scripts\"
Set-Content "$Win64\ue4ss\Mods\BallestGrindStats\enabled.txt" "" -Encoding ascii

Write-Host "BallestGrindStats installed to $Win64\ue4ss\Mods\BallestGrindStats"
