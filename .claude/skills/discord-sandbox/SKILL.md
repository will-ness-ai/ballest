---
name: discord-sandbox
description: Play Multiballs in real Discord with `pnpm axi` and the sandbox bot. Use after changing what the bot posts, draws, pings or answers (src/discord/, src/render/, messages.ts), or to reproduce a bot bug seen in Discord.
---

# Discord sandbox

The unit tests stop at the Surface and the payloads; this is the check for what Discord itself
shows. You play a Match as two bots in a channel of your own and read every post back.
`discord-bot/AGENTS.md` ("The sandbox") is the reference for the tools; this is the run.

## 1. Find a machine that reaches Discord

Cloud containers can't reach discord.com, and the Admin app's token lives only in Will's main
checkout `.env`. From a cloud thread, start a Remote Control session on Will's PC and brief it
with these steps; it works in its own worktree of your branch (`git worktree add`), never in the
main checkout. Done when `pnpm --silent axi` there prints an `as:` line ending in `(Admin app)`.
If it says the dev bot's token instead, the Admin app isn't set up: see AGENTS.md.

## 2. Start a sandbox

`pnpm --silent axi sandbox create`, then `pnpm sandbox` as a background process; note its pid.
Done when `.logs/sandbox.log` says `sandbox driver on`. Another copy of the bot (`pnpm dev`)
may be running for someone else's test: leave that process and its channel alone. If a thread
asked for Will's go-ahead before running beside it, that go-ahead is a message he types.

## 3. Play through what changed

Players are `--as admin` and the dev bot's member id (`pnpm --silent axi members`): bots, so
no person is pinged. Follow each answer's `help[]` lines. Cover every surface the change
touches, from the first click to the Result if the change reaches it:

- `press` by label, then `submit` the Link form (`profile=<any name>`) and confirm.
- `time <match> <seconds> --as <player>` sets a run; the engine reads it on its next poll.
- `wait improved --in <thread>` (an improvement post is an image alone) or `wait "Final result" --in <thread>`:
  both post in the Match Thread, and `wait` without `--in` reads only the channel.
- `show <id>` saves a post's images; open each one and compare it with what the change meant.

Done when every post the change affects has been read and its image opened.

## 4. Clean up and report

Stop the sandbox by its pid, then `pnpm --silent axi sandbox delete`. Report what each changed
post showed (a line per image), anything that looked wrong, and fix any harness bug you hit in
`scripts/axi.ts` or `scripts/sandbox/` on the same branch.
