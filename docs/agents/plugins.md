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

Drive the slots and Will's game with `python tools/sandbox.py` in `ballest-plugin-manager` (branch `sandbox-tools` on
Will's fork until upstream takes it). Run bare, it shows the running slots and Will's game with their host versions,
plugins and log errors; `<command> --help` gives each command's flags and examples. The usual loop:

- `start next --plugin ../ballest-grind-stats --map Map_Track_S2_Sampler` (add `--host build/version.dll` to run a host
  build in that slot only), then `run <slot> -c "cmd; cmd"`, which prints only the commands' replies. Besides the host
  test commands it takes `sleep`, `wait <regex>`, `waitstate <regex>` (until a window's text matches: check a `press`
  landed before a `shot`) and `shot <name>`.
- `reload <slot> <plugin folder>` after editing a plugin: re-copied and restarted in the running slot.
- `install-player <plugin folder>` when Will wants a plugin in his own game: it copies only that folder, restarts his
  game (do this yourself, even mid-run), waits for the plugin's "loaded" line and prints its errors.
- `front <slot|player>` brings a window in front for Will; `log <slot|player> --errors`; `stop <slot>`.

The older `tools/test_instance.py` and `tools/dev_session.py` it wraps still work. How a map's checkpoints work (goals,
the finish, strips, what a touch changes) is in the comment above `Checkpoints()` in the host's `src/host/ghosts.cpp`
(branch `checkpoint-notes` on the fork until upstream takes it). What the commands can and can't do:

- `open` loads a map without the menu's setup, so no run starts by itself. Start one, and restart it, with
  `callx GM_Climb_C S_RPC_PlayerWantsToRestart | o:BP_MyPlayerController_C` (Circuit maps; the first call starts a run, an
  attempt, and each one after it is a restart; the host reports practice on).
- `setting <plugin> <variable> <value>` changes a plugin setting; `state` lists every window's texts, the way to read
  a card's numbers.
- `press <vk>` is a key for the plugins (F6 is 117, F8 is 119). `post <vk>` goes to the game window but doesn't
  steer the ball, so played time and anything that needs the ball to move or finish still needs Will to play.
- `teleport <x> <y> <z>` moves the ball. Into a strip's trigger (`checkpoints` lists them) it touches that checkpoint;
  goals can't be touched this way, since practice turns their hitboxes off.
