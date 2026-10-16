---
name: agent-tools
description: Build commands for agents in AXI style. Use when writing or changing a script or CLI whose reader is an agent, or when an agent needs a chain of tool calls that one command could answer.
---

# Agent tools

An **agent tool** is a command whose reader is an agent, not a person. Its cost is **turns**
(every follow-up call re-reads the context) and **tokens** (every line it prints stays in the
window). Its job is to collapse a **chain** of tool calls (repeated or not: read a config, query
a service, filter the answer, open a file) into one, and print the **minimally relevant
context**: everything the agent would have gone on to use from that chain, and nothing else.
Fewer turns, a smaller window, the same facts in hand. The style is AXI ([axi.md](https://axi.md); the upstream spec is
[kunchenguid/axi's skill](https://raw.githubusercontent.com/kunchenguid/axi/main/.agents/skills/axi/SKILL.md)),
adapted to this repo below. Three tools here already work this way; read the closest one before
starting:

- `pnpm --silent axi` (`discord-bot/scripts/axi.ts`, rows from `scripts/axi/describe.ts`): the
  Discord test server.
- `pnpm --silent qa` (`web/scripts/qa.mjs`): every page of the site, preview against production.
- `python tools/sandbox.py` in `ballest-plugin-manager`, on branch `sandbox-tools` until upstream
  takes it: sandboxed game copies and Will's game.

They predate this skill and differ from it in details (`qa` prints `next:` and exits 1 on a usage
error). The rules below are the contract: follow them in a new tool, and bring an old one in line
in the part you touch.

## Steps

1. **Name the chain.** Write down the calls an agent makes today to answer the question
   the tool is for (from the session or retro that asked for it): each command, what it printed,
   what the agent kept of it. Done when you can say which of those calls the tool replaces, and
   the turn count before and after.
2. **Shape the commands.** One entry point with subcommands, run the way the package runs
   scripts (`pnpm --silent <name>` in a Node package, `python tools/<name>.py` in Python). Write
   each command's `--help` first, from the rules below. Done when every link of the chain maps to
   one command, and the bare run's output is sketched.
3. **Build it** to the rules below, with tests for its parsing and row formatting (as
   `discord-bot/test/axiDescribe.test.ts` does). Done when every rule is met or its absence is
   a deliberate choice you can name, and the tests pass.
4. **Run it as the agent will.** In a fresh shell: the bare run, each command's happy path, an
   empty result, a misspelt flag, a missing argument and a dependency failure (network down,
   process not running). Done when each output alone tells the agent its next step, nothing
   leaks a stack trace, and the chain from step 1 takes the turns you promised.
5. **Point at it.** Add one line where agents working in that area already look (the package's
   `AGENTS.md`, the `docs/` page, the skill that drives the work), naming the command and when to
   run it; its `--help` carries the rest. Call the Skill tool for 'writing-for-agents', and word
   that line by it. Done when an agent starting cold on that area's work would reach the line
   before building its own chain.

## Rules

**Output**

- **Rows, not prose.** Lists print as a [TOON](https://toonformat.dev/)-shaped header and rows:
  `matches[3]{id,state,players}:` then one comma-separated line each, quoting any value that
  holds a comma, a colon or a quote. Detail views print `key: value` lines. Plain text, no
  colour, no space-padded tables.
- **Few fields, enough rows.** A list row carries what lets the agent pick the next call: an
  id, a name, a state. Everything else waits for the detail view or `--full`. Default limits
  cover the common case in one call.
- **Cut long text with its size.** A long value prints its first 500-1500 characters and
  `… (truncated, 8432 chars total; use --full)`. Images and other files are written to disk and
  printed as paths for the agent to read.
- **Answer the next question too.** Include the totals and summaries the agent would otherwise
  fetch next: `count: 30 of 847`, `checks: 3/3 passed`, `errors: 2`. Only what is cheap to
  compute.
- **Say nothing found.** An empty result is a line that says so, with its scope:
  `faults: none on 14 pages at 4 sizes`.
- **Only what is wrong.** A check prints its failures and a one-line pass summary, never every
  passing case.

**Flow**

- **Home view.** Run bare, the tool prints live state (what is running, what is set up, what
  needs doing), then its commands. A usage page is for when there is no state to show.
- **Next steps.** End list, mutation and error output with a `help[N]:` block of complete
  commands that follow from it, carrying the flags in use and `<id>`-style placeholders for
  values the agent must fill. Offer a few directions, not a fixed sequence. A detail view that
  fully answers leaves it out.
- **Waits are commands.** When the agent would otherwise poll (a log line, a message, a window),
  give it a `wait <pattern>` that returns when it matches and says so when it times out.
- **Mutations repeat safely.** Asking for a state that already holds succeeds with `(no-op)`.

**Errors and channels**

- **stdout is for the agent.** Data, errors and next steps all go to stdout, in the same shape;
  progress and debug go to stderr. Exit 0 for success and no-ops, 1 for a failure, 2 for a usage
  error (an unknown command or flag, a missing argument).
- **Errors say the fix.** `error: no sandbox channel yet` then the `help[1]:` command that makes
  one. Translate a dependency's error into the tool's own terms and commands.
- **Reject what you don't know.** An unknown command or flag is a usage error naming it and
  listing that command's flags, checked before anything runs. A renamed flag names its
  replacement.
- **Flags only.** Every input comes from arguments; a missing one fails at once with the flag
  it needs. Nothing waits on stdin.

**Help**

- `<command> --help` prints that command's flags with defaults and two or three examples, and
  nothing about the other commands.
- The file opens with a comment saying it is for agents and follows the `agent-tools` skill,
  so a later editor keeps the contract. The rules live here, not restated per tool.

**Left out of AXI.** These tools run from a checkout, never a global install, so AXI's session
hooks, installable skill, `bin:` line and `--version` fast path don't apply; step 5's pointer
does the hooks' job. A tool whose state every session in an area needs could earn a
`SessionStart` hook in `.claude/settings.json`; ask Will before adding one, since it loads on
every session.
