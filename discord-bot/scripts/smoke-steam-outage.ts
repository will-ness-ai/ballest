// Live check that the Steam session logs on afresh when Steam stops answering (#142),
// against real Steam with the bot account's secrets. The first client goes deaf after one
// good read, like the connection on 2026-10-06: Steam's replies never reach it. The session
// should replace it with a fresh client after FRESH_LOGON_AFTER_MS and read again.
//   pnpm smoke:steam-outage
import { ConfigProvider, Effect, Either } from "effect";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeSteamSession, steamUserClient, type SteamClient } from "../src/steam/session.js";

const mainCheckout = dirname(
  execSync("git rev-parse --path-format=absolute --git-common-dir").toString().trim(),
);
const envFile = process.env.MULTIBALLS_ENV ?? join(mainCheckout, "discord-bot", ".env");
const env = new Map(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l): [string, string] => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const MAIN = "76561198047685844"; // has campaign times
const MAP_TRACK13 = 17800617;
/** Long enough for the wait before a fresh log on, the log on, and a few reads. */
const GIVE_UP_MS = 6 * 60_000;

const stamp = () => new Date().toISOString().slice(11, 19);

const program = Effect.gen(function* () {
  const clients: Array<SteamClient> = [];
  let deaf = false;
  const session = yield* makeSteamSession(() => {
    const client = steamUserClient();
    if (clients.length === 0) {
      // The first client: once deaf, every request goes out and no reply ever comes back.
      // steam-user's own callbacks take more than the reply (its auth code reads the header),
      // so every argument is passed on.
      const send = client._send.bind(client);
      client._send = (header, body, callback) =>
        send(header, body, (...args: Parameters<typeof callback>) => {
          if (!deaf) callback(...args);
        });
    }
    clients.push(client);
    console.log(`${stamp()} client ${clients.length} made`);
    return client;
  });

  const first = yield* session.players(MAP_TRACK13, [MAIN]);
  console.log(`${stamp()} read with client 1: ${first.length} entry`);
  deaf = true;
  console.log(`${stamp()} client 1 is deaf now; reading every 10 s`);

  const started = Date.now();
  while (Date.now() - started < GIVE_UP_MS) {
    const read = yield* Effect.either(session.players(MAP_TRACK13, [MAIN]));
    if (Either.isRight(read)) {
      const ok = clients.length > 1;
      console.log(
        `${stamp()} read answered with client ${clients.length}: ${ok ? "PASS, logged on afresh" : "FAIL, the deaf client answered"}`,
      );
      return ok;
    }
    console.log(`${stamp()} read failed: ${read.left.reason}`);
    yield* Effect.sleep("10 seconds");
  }
  console.log(`${stamp()} FAIL: no answer within ${GIVE_UP_MS / 60_000} minutes`);
  return false;
});

Effect.runPromise(
  program.pipe(Effect.scoped, Effect.withConfigProvider(ConfigProvider.fromMap(env))),
).then(
  (ok) => process.exit(ok ? 0 : 1),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
