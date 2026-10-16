---
name: agent-tools
description: Build agent tools in AXI style. Use when writing or changing a script, CLI or command an agent runs (like `pnpm axi`, `pnpm qa`, `tools/sandbox.py`), or when a session keeps spending turns on a loop a tool could do in one call.
---

# Agent tools

An **agent tool** is a command whose reader is an agent, not a person. Its cost is **turns**
(every follow-up call re-reads the context) and **tokens** (every line it prints stays in the
window). Build it so an agent gets from question to next action in one call, reading only what
it needs. The style is AXI ([axi.md](https://axi.md); the full upstream spec is
[kunchenguid/axi's skill](https://raw.githubusercontent.com/kunchenguid/axi/main/.agents/skills/axi/SKILL.md)),
adapted to this repo below. Three tools here already follow it; read the closest one before
starting and match it:

- `pnpm --silent axi` (`discord-bot/scripts/axi.ts`, rows from `scripts/axi/describe.ts`): the
  Discord test server.
- `pnpm --silent qa` (`web/scripts/qa.mjs`): every page of the site, preview against production.
- `python tools/sandbox.py` (`ballest-plugin-manager`): sandboxed game copies and Will's game.

## Steps

1. **Name the loop.** Write down the run of calls an agent makes today to answer the question
   the tool is for (from the session or retro that asked for it): each command, what it printed,
   what the agent kept of it. Done when you can say which of those calls the tool replaces, and
   the turn count before and after.
2. **Shape the commands.** One entry point with subcommands, run the way the package runs
   scripts (`pnpm --silent <name>` in a Node package, `python tools/<name>.py` in Python). Write
   each command's `--help` first, from the rules below. Done when every step of the loop maps to
   one command, and the bare run's output is sketched.
3. **Build it** to every rule under "Rules", with tests for any parsing or formatting a later
   change could break (as `discord-bot/test/axiDescribe.test.ts` does).
4. **Run it as the agent will.** In a fresh shell: the bare run, each command's happy path, an
   empty result, a misspelt flag, a missing argument and a dependency failure (network down,
   process not running). Done when each output alone tells the agent its next step, nothing
   leaks a stack trace, and the loop from step 1 takes the turns you promised.
5. **Point at it.** Add one line where agents working in that area already look (the package's
   `AGENTS.md`, the `docs/` page, the skill that drives the work), naming the command and when to
   run it; its `--help` carries the rest. Call the Skill tool for 'writing-for-agents' to word
   that line, and for a skill if the tool's use is a sequence of steps.

## Rules

**Output**

- **Rows, not prose.** Lists print as a TOON-shaped header and rows: `matches[3]{id,state,players}:`
  then one comma-separated line each. Detail views print `key: value` lines. Plain text, no
  colour, no tables padded with spaces.
- **Few fields.** A list row carries what lets the agent pick the next call: an id, a name, a
  state. Everything else waits for the detail view or a `--fields` / `--full` flag.
- **Cut long text with its size.** A long value prints its first few hundred characters and
  `... (cut, 8432 chars)`, with the `--full` command that shows it all. Images and other files
  are written to disk and printed as paths for the agent to read.
- **Answer the next question too.** Include the totals and summaries the agent would otherwise
  fetch next: `count: 30 of 847`, `checks: 3/3 passed`, `errors: 2 (log --errors)`. Only what is
  cheap to compute.
- **Say nothing found.** An empty result is a line that says so, with its scope:
  `faults: none on 14 pages at 4 sizes`.
- **Only what is wrong.** A check prints its failures and a one-line pass summary, never every
  passing case.

**Flow**

- **Home view.** Run bare, the tool prints live state (what is running, what is set up, what
  needs doing), then its commands. Never a usage page when there is state to show.
- **Next steps.** End list, mutation and error output with a `help:` block of complete commands
  that follow from it, carrying the flags in use and `<id>`-style placeholders for values the
  agent must fill. A detail view that fully answers leaves it out.
- **Waits are commands.** When the agent would otherwise poll (a log line, a message, a window),
  give it `wait <pattern> [--timeout s]` that returns when it matches and says so when it times
  out.
- **Mutations repeat safely.** Asking for a state that already holds succeeds with `(no-op)`.

**Errors and channels**

- **stdout is for the agent.** Data, errors and next steps all go to stdout, in the same shape;
  progress and debug go to stderr. Exit 0 for success and no-ops, 1 for a failure, 2 for a usage
  error.
- **Errors say the fix.** `error: no sandbox channel yet` then `help: pnpm --silent axi sandbox
  create`. Translate a dependency's error into the tool's own terms.
- **Reject what you don't know.** An unknown command or flag is a usage error naming it and
  listing that command's flags, checked before anything runs.
- **Flags only.** Every input comes from arguments; a missing one fails at once with the flag
  it needs. Nothing waits on stdin.

**Help**

- `<command> --help` prints that command's flags with defaults and two or three examples, and
  nothing about the other commands.
- The file opens with a comment saying it is for agents and in AXI style, as the three above
  do, so a later editor keeps the contract.
