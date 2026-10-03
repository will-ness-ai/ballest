---
name: wizard
description: Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, filling a Claude cloud environment's variables or network access, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Reserve it for steps the agent cannot perform itself.
---

# Wizard

A **wizard** is a bash script that walks a human, step by step, through a manual procedure that's tedious to do by hand and tedious to re-explain to an AI every time. It opens each URL, says exactly what to click and copy, captures the values, writes them where they belong (`.env`, GitHub secrets, or a settings dialog the human pastes into), confirms at every stage, and shows how many stages are left. It might configure third-party services, run a one-off migration, or move the project from one state to another.

The delightful UX is already solved by [template.sh](template.sh): stage-by-stage progress, confirmation gates, cross-platform URL opening (including WSL), hidden secret entry, idempotent `.env` upserts, `gh secret`/`gh variable` writes, and a closing summary. **Your job is only to scope the procedure and author its stages.** The library above the `STAGES` marker is identical in every wizard; that consistency is the point: never hand-edit it.

A wizard is ephemeral by default: built for one run, saved to a scratch or `scripts/` path, deleted when the job's done. Commit it only when the user wants a repeatable setup path that should live in the repo.

## Process

### 1. Scope the procedure

Work out every manual step the human must take and every value that gets captured along the way. Read the repo first, don't ask cold:

- For setup: `.env`, `.env.example`, `.env.*`, `README`, `docker-compose*`, framework config, and `.github/workflows/*` (every `secrets.*` / `vars.*` reference is a value the wizard must produce).
- For a migration or transition: the current state, the target state, and the irreversible actions between them.
- For a value that lands in a settings page with no CLI or API (the Claude cloud environment's variables and Allowed domains are one), the wizard's job ends at the clipboard: it copies the `KEY=value` block and walks the dialog.

Then show the user the ordered list of stages and the values each produces, and confirm: they may add, drop, or reorder.

**Done when:** every stage is named in order, and for each captured value you know (a) where the human gets it, (b) where it's written (`.env`, a GitHub secret, a settings dialog, or nowhere; some stages are pure actions), and (c) whether it's secret (hidden entry) or public.

Each `.env` here (the root one with the Steam secrets, `discord-bot/.env` with the bot's) lives in the main checkout, never a worktree: resolve it from the parent of `git rev-parse --path-format=absolute --git-common-dir`. A value bound for anywhere else goes to a throwaway hand-off file in `$HOME`, and that hand-off file is the only file a wizard ever offers to delete.

### 2. Map each stage's journey

For each stage, write the precise path a human follows: which URL to open, what to do there, where a value is shown, which variable it fills: e.g. "Dashboard → Developers → API keys → Reveal test key → copy". Where you don't actually know the current UI or the exact command, say so and ask the user or check the docs: never invent steps that may not exist. A step written from memory of a dashboard gets a `note` with an escape path ("if that section isn't there, press Enter and tell Claude").

**Done when:** every stage traces to concrete instructions a stranger could follow.

### 3. Author the wizard

Copy `template.sh` to the target path. Replace the example stage with one `stage` per step, in dependency order. Use the library helpers: `stage`, `say`/`step`, `open_url`, `ask`/`ask_secret`, `write_env`, `set_secret`/`set_var`, `pause`/`confirm`. Set `TOTAL_STAGES` to the number of stages you wrote.

Hold the bar the template sets: open the URL before asking for its value, use `ask_secret` for anything secret, `write_env` every persisted value, `set_secret` only the values CI actually needs, and `confirm` before any irreversible action. Each `stage` clears the screen so only the current step is visible: keep a stage to one focused task so nothing the human needs scrolls away. Don't touch the library above the marker. Two library behaviours bite authors:

- The library assigns `ENV_FILE="${ENV_FILE:-.env}"` before your stages run, so a `${ENV_FILE:-…}` default in the stages never fires. Assign the hand-off file plainly: `ENV_FILE="$HOME/.something-env"`.
- `set -euo pipefail` is on: a `grep` that can match nothing inside `$(…)` needs `|| true`, and a value the later stages require is read in an `until [[ -n "$X" ]]` loop.

A value bound for the clipboard goes through `clip.exe`, then `pbcopy`, then `xclip`, printing the block when none exists.

### 4. Verify

- `bash -n <script>`; run `shellcheck` if available.
- `chmod +x <script>`.
- Strip CRLF line endings, then confirm it boots: `timeout 5 bash <script> </dev/null` reaches the banner's "Ready to start?" with no error, and writes nothing.
- Dry-run it by piping one answer per prompt, with `HOME` pointed at a scratch folder and `ENV_FILE` left unset, so the run exercises the script's own file choice: `printf '\n\nvalue1\nvalue2\n…' | HOME=<scratch> bash <script>`. Then check that every value from step 1 landed where step 1 said, that the repo's `.env` is untouched, and that every `set_secret` name exactly matches a `secrets.*` reference in CI.

### 5. Deliver it to the human's machine

The wizard runs where the human's browser is: Will's Windows PC. Will expects it already running in a window on his desktop; his only job is typing into it. A cloud session reaches his PC through a Remote Control session in his Ballest folder:

1. Hand that session the whole script inline in its instructions. It writes it to `scratch/<name>.sh` with LF endings and repeats the boot check from step 4 there.
2. It launches a new visible window running the script by absolute path: `Start-Process "C:\Program Files\Git\git-bash.exe" -ArgumentList "-c","bash /c/Users/Will/Documents/Projects/Ballest/scratch/<name>.sh; exec bash"`. Have the script append a line to `scratch/<name>.log` at its first screen, and the session confirms that line appeared before you tell Will the window is up.
3. Your reply names the window and the first screen he should see. Keep a copy at `/mnt/project-files/wizards/<name>.sh` attached as the fallback.
4. When he says he's done, the session deletes `scratch/<name>.sh` and its log and confirms the hand-off file is gone with `test -e`, never reading it. A fix to the script waits for this point too: bash reads a running script as it goes, so rewriting it mid-run corrupts the wizard he's typing into.

**Done when:** the human has finished the run, and neither the script nor the hand-off file is left on his machine.

If it's a repeatable setup path, commit it and link it from the README so the next person runs the script instead of asking an AI.
