# Plugins and the plugin manager

Will co-contributes to AnythingGoes's plugin manager (the in-game plugin host, `version.dll`) and its plugins. Their
repos are the source of truth; Will works in forks and sends pull requests. Nothing here is part of this repo's site
or CI.

## Checkouts

On Will's PC, each repo is one clone next to this one in `Documents\Projects\`, named after the repo:

| Folder                   | `origin` (push here)                  | `upstream` (pull requests go here)            |
| ------------------------ | ------------------------------------- | --------------------------------------------- |
| `ballest-plugin-manager` | `will-ness-ai/ballest-plugin-manager` | `AnythingGoes-ballest/ballest-plugin-manager` |
| `ballest-grind-stats`    | `will-ness-ai/ballest-grind-stats`    | `AnythingGoes-ballest/ballest-grind-stats`    |

The folder name is load-bearing: the test copy installs a plugin folder as the id it is named for, minus
`ballest-` (`ballest-grind-stats` runs as `grind-stats`). A new fork gets a row here and in `FORKS` in
`tools/sync_plugin_forks.py`.

Cloud sessions can't reach AnythingGoes's repos. They push branches to Will's forks; this PC opens the upstream pull
request, rebases onto upstream, and runs anything in the game.

## Fork rules

- Each fork's `main` is a copy of upstream's `main`: never commit on it. Start every change as a branch off
  `upstream/main`.
- Run `python tools/sync_plugin_forks.py` at the start of a session. It fast-forwards each fork's `main` on GitHub
  and in its checkout, and refuses a `main` that has drifted.
- Before opening a pull request, fetch `upstream` and rebase onto it if it moved. When the rebase rewrites a branch
  that's already pushed, push it as a new branch; a fork branch is never force-pushed.
- Upstream picks version numbers. Bump `kHostVersion` (`src/host/plugins.hpp`) or a plugin's `info.toml` `version`
  so `min_host` can name the change, and say in the pull request that they may renumber it (they shipped our 0.24.0
  as 0.23.6).
- Their `CLAUDE.md` holds the review rules every change must pass (no built binaries, no `Console::` in plugins) and
  bans Claude attribution lines in commits and pull requests. `python tools/review_guard.py changed upstream/main`
  checks the first two.

## Building the host

`./build.sh` in `ballest-plugin-manager` builds `build/version.dll` with llvm-mingw from `tools/llvm-mingw/`
(gitignored; on this PC it's llvm-mingw 20260922 ucrt-x86_64). `tools/tests/run.sh [plugin folder]...` builds, then
compiles each plugin against the host's real API: the check for a plugin change.

## Testing in the game

Test in a sandboxed copy: `tools/test_instance.py` in `ballest-plugin-manager` (needs `pip install pefile`). A copy
(slot 1-9) has its own saves, settings, plugins and log under `%LOCALAPPDATA%\BallestTest<N>`, can't go online or
write records, and runs muted behind other windows, so Will can play his own game at the same time. Will's own
install stays on official releases and keeps his settings; `build.sh install` and `install.sh` change it, and are run
only when he asks.

`tools/dev_session.py commands.txt --slot 1 --plugin ../ballest-grind-stats --map Map_Track_S2_Sampler` starts slot
1 with that plugin, opens the map, runs the commands (host test commands, plus `sleep`, `wait`, `shot`), prints the
host log and stops the copy. To run a host build in the slot only, start the slot first with
`python tools/test_instance.py start 1 --host build/version.dll --plugin ../ballest-grind-stats` (the host log says
"running the copy's own host build"), then add `--attach` to the `dev_session.py` line and leave out `--map`
(`open <map>` is a command). What the commands can and can't do:

- `open` loads a map without the menu's setup, so no run starts by itself. Start one, and restart it, with
  `callx GM_Climb_C S_RPC_PlayerWantsToRestart | o:BP_MyPlayerController_C` (Circuit maps; the first call starts a run, an
  attempt, and each one after it is a restart; the host reports practice on).
- `setting <plugin> <variable> <value>` changes a plugin setting; `state` lists every window's texts, the way to read
  a card's numbers.
- `press <vk>` is a key for the plugins (F6 is 117, F8 is 119). `post <vk>` goes to the game window but doesn't
  steer the ball, so played time and anything that needs the ball to move or finish still needs Will to play.
