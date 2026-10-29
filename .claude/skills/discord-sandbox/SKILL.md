---
name: discord-sandbox
description: Play Multiballs in real Discord with `pnpm devserver` and the sandbox bot. Use after changing what the bot posts, draws, pings or answers (src/discord/, src/render/, messages.ts), or to reproduce a bot bug seen in Discord.
---

# Discord sandbox

The unit tests stop at the Surface and the payloads; this is the check for what Discord itself
shows. You play a Match as two bots in a channel of your own and read every post back.
`discord-bot/AGENTS.md` ("The sandbox") is the reference for the tools; this is the run.

## 1. Check this machine reaches Discord

Run `pnpm --silent devserver` in `discord-bot/`, here first: a cloud thread holds the dev app's tokens
and reaches discord.com. Done when its `as:` line ends in `(Admin app)`. Only when it says
discord.com didn't answer, or names the dev bot's token instead, go to Will's PC: start a Remote
Control session and brief it with these steps, in its own worktree of your branch
(`git worktree add`), never the main checkout.

## 2. Start a sandbox

`pnpm --silent devserver sandbox create`, then `pnpm --silent devserver sandbox start` (`--cup` for the Weekly
Cup's clock). Done when it prints `bot: running`: it returns once the bot has logged in. Another
copy of the bot (`pnpm dev`) may be running for someone else's test: leave that process and its
channel alone. If a thread asked for Will's go-ahead before running beside it, that go-ahead is a
message he types.

## 3. Play through what changed

Players are `--as admin` and the dev bot's member id (`pnpm --silent devserver members`): bots, so
no person is pinged. Follow each answer's `help[]` lines. Cover every surface the change
touches, from the first click to the Result if the change reaches it:

- `press` by label, then `submit` the Link form (`profile=<any name>`) and confirm.
- `time <match> <seconds> --as <player>` sets a run; the engine reads it on its next poll.
- `wait improved --in <thread>` (an improvement post is an image alone) or `wait "Final result" --in <thread>`:
  both post in the Match Thread, and `wait` without `--in` reads only the channel.
- `show <id>` saves a post's images; open each one and compare it with what the change meant.

Done when every post the change affects has been read and its image opened.

## 4. Clean up and report

`pnpm --silent devserver sandbox stop`, then `pnpm --silent devserver sandbox delete`. Report what each changed
post showed (a line per image), anything that looked wrong, and fix any harness bug you hit in
`scripts/devserver.ts` or `scripts/sandbox/` on the same branch.
