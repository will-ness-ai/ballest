# BallestGrindStats

A [UE4SS](https://github.com/UE4SS-RE/RE-UE4SS) Lua mod for Ballest of Them All that
keeps per-map grind stats, after Trackmania's Grinding Stats plugin: time on the map,
attempts and finishes, all-time and this session. It draws a small card top-left while
you are in a track.

This is local-only and separate from the leaderboard site: nothing here is read by
`index.html` or the collector.

## Install

1. Download the UE4SS **experimental** build (the tagged 3.0.1 predates the engine version
   Ballest runs on) from the
   [releases page](https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/experimental-latest)
   — the `UE4SS_v3.0.1-*.zip` asset — to `%TEMP%\ue4ss.zip`.
2. Windows Defender flags the proxy `dwmapi.dll` as a trojan (a false positive for every
   proxy-DLL loader). Add an exclusion for the game's `Binaries\Win64` folder first, from an
   admin PowerShell:

   ```powershell
   Add-MpPreference -ExclusionPath "C:\Program Files (x86)\Steam\steamapps\common\Ballest of Them All\Ballest\Binaries\Win64"
   ```

3. Run `install-ue4ss.ps1`. Re-run it to push an edited `main.lua` / `overlay.lua`.

Uninstall by deleting `Win64\dwmapi.dll` and `Win64\ue4ss\`.

## Use

- The card appears whenever the ball exists and follows the current map.
- **F6** hides / shows the card. **F8** writes the current map's line to `ue4ss\UE4SS.log`.
- **Ctrl+R** reloads the Lua after an edit (hot reload is enabled by the installer).
- Stats persist in `Win64\ue4ss\Mods\BallestGrindStats\grindstats.txt`, one tab-separated
  line per map: `name  seconds  attempts  finishes  best`. Campaign maps use their asset
  names (`Map_Track_S2_Sampler`, the same as `data/boards/`); custom maps use their title.

## How it reads the game

Everything comes from the game's own Blueprint events and properties; `main.lua`'s header
lists them. The discovery was done with UE4SS's `RegisterHook` on every candidate and
the log — none of it is inferred from timing or screen contents. `session` resets on every
level load (`InitGameState`), which fires for menu ↔ track but not for R or "improve".
