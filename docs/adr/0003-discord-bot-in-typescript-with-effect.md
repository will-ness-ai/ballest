# The Discord bot is TypeScript (Effect), not Python

All of the proven Steam leaderboard code is Python (steam.py), but the Discord bot is
written in TypeScript on Effect by preference. Its Steam access is ported to node
`steam-user`, sending the leaderboard protobufs through that library's internal `_send`
with the `routing_appid` header set by hand. That is a private API, so the version is
pinned. A spike proves board lookup by name and per-player entry reads work before the
bot is built on them.

## Considered Options

- Python with discord.py, reusing steam.py directly.
- A TypeScript bot with a Python sidecar serving Steam reads: proven code, but two
  runtimes to deploy.
