// `pnpm sandbox`: a copy of the bot for agents to drive, in its own channel on the test server
// (made by `pnpm axi sandbox create`). It is the real bot on the dev app, with two swaps: the
// tests' fake Steam, so any Player can link and set times on demand, and the driver
// (scripts/sandbox/driver.ts), which clicks buttons as any member. A fresh database each start;
// log in .logs/sandbox.log. Drive it with `pnpm axi`.
//
// `--cup` switches the Weekly Cup on in the sandbox's server, on a clock `axi clock` moves forward
// (scripts/sandbox/clock.ts); `--keep` keeps the database and the clock from the last run, to
// check a restart.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { app } from "../src/app.js";
import { Steam } from "../src/ports.js";
import { makeFakeSteam, makeMap } from "../test/harness.js";
import { devEnvFile } from "./devEnv.js";
import { launchUntilShutdown } from "../src/restart.js";
import { makeDriver } from "./sandbox/driver.js";
import { makeDevClock } from "./sandbox/clock.js";
import { DRIVER_PORT, LOGS, readSandbox, SANDBOX_HTTP_PORT } from "./sandbox/config.js";

const sandbox = readSandbox();
if (sandbox === null) {
  console.log("error: no sandbox channel yet. Make one with: pnpm axi sandbox create");
  process.exit(1);
}

const cup = process.argv.includes("--cup");
const keep = process.argv.includes("--keep");

mkdirSync(LOGS, { recursive: true });
const db = join(LOGS, "sandbox.sqlite");
if (!keep) for (const f of [db, `${db}-shm`, `${db}-wal`]) if (existsSync(f)) rmSync(f);
process.env.LOG_FILE = join(LOGS, "sandbox.log");
writeFileSync(process.env.LOG_FILE, "");
process.env.DB_PATH = db;
process.env.DISCORD_CHANNEL_ID = sandbox.channelId;
process.env.MULTIBALLS_SANDBOX = "true";
process.env.PORT = String(SANDBOX_HTTP_PORT);
process.env.MULTIBALLS_ENV = devEnvFile();
if (cup) {
  process.env.SANDBOX_WEEKLY_CUP = "true";
  process.env.WEEKLY_CUP_GUILD_IDS = sandbox.guildId;
}

// Real Workshop Maps (names, makers, pages and Steam's preview pictures), so the Cup's Shortlist
// of 10 shows what it will in a real server. Their boards and times are the fake Steam's.
const MAPS = (
  [
    [
      "Sway n So",
      "thranse",
      "3796933002",
      "https://images.steamusercontent.com/ugc/14997862934891093763/F32E517F8A2FAC3A24A92D4BBBA09C73C87B8935/",
    ],
    [
      "the drop",
      "AvgRon",
      "3796494598",
      "https://images.steamusercontent.com/ugc/18293733087848093630/8241FF36E1474DE6C07A2C0331D57CCC8DBEA8A9/",
    ],
    [
      "A08",
      "Slati Jnr",
      "3755236154",
      "https://images.steamusercontent.com/ugc/10658412377853583650/72597B8E2B4D29D6A43DB7ABA0B66449F6D8A865/",
    ],
    [
      "Jumping and bumping",
      "maxthedude",
      "3799090646",
      "https://images.steamusercontent.com/ugc/13255723511070562057/4DD23B6CF6942AA0422FC2A2537784CB90015D6A/",
    ],
    [
      "Brand New TV Offer v2",
      "Billy Mays Here",
      "3802991891",
      "https://images.steamusercontent.com/ugc/16583049194107635405/6CDA85CB54D5ED6041717B8A0E83D00D146B7774/",
    ],
    [
      "AJC4",
      "Action Jackson",
      "3762695115",
      "https://images.steamusercontent.com/ugc/16438736057311524995/30256D14AC7AE23AD29EF3507AC878B5D00678F2/",
    ],
    [
      "Come And Get A Flat Bread",
      "Doe Bailin",
      "3805306900",
      "https://images.steamusercontent.com/ugc/18422950133363061908/2F89572CDB5EDD9D16305E373B75B3BD5D06E01C/",
    ],
    [
      "please use scenery",
      "Dain",
      "3806993482",
      "https://images.steamusercontent.com/ugc/10991558970260779563/D28C2427A80B752D24CC95A8AA3F28D1B0006BB1/",
    ],
    [
      "SANDSTONE",
      "Palex",
      "3798532776",
      "https://images.steamusercontent.com/ugc/18051357036826682150/86DB516F8217C64226E4935076D0998815E2FB5D/",
    ],
    [
      "Rainbow Amphitheater",
      "Raincake",
      "3805044786",
      "https://images.steamusercontent.com/ugc/16189183287278868249/4833D83E5D73F9DF00E82F3E443D2E3A79C1F032/",
    ],
    [
      "FrootLoops",
      "Moon CPC",
      "3592119509",
      "https://images.steamusercontent.com/ugc/15385805123412378586/945BDEB226EBF15C665C20D22CFF1767F784BECE/",
    ],
    [
      "Crimson Flux",
      "CoS",
      "3810099846",
      "https://images.steamusercontent.com/ugc/16508777602063881011/220AD5A8994CA97C0A202887B6876310F80AA90E/",
    ],
  ] as const
).map(([title, creator, pfid, previewUrl], i) =>
  makeMap(i + 1, { title, creator, pfid, previewUrl }),
);

const steam = Effect.runSync(makeFakeSteam({}));
Effect.runSync(steam.control.setCatalogue(MAPS));

/** Any profile resolves: `bob` or `https://steamcommunity.com/id/bob` is the fake account `fake-bob`. */
const AnyProfileSteam = Layer.succeed(
  Steam,
  Steam.of({
    ...steam.port,
    resolveProfile: (input) => {
      const name = input.replace(/\/+$/, "").split("/").at(-1) ?? input;
      return Effect.succeed({
        steamId: `fake-${name}`,
        personaName: name,
        avatarUrl: "",
        campaignTracks: 21,
        campaignTrackTotal: 23,
      });
    },
  }),
);

const clock = makeDevClock(keep);
const driver = makeDriver({
  port: DRIVER_PORT,
  channelId: sandbox.channelId,
  steam: steam.control,
  clock,
  maps: MAPS,
});

launchUntilShutdown(app(AnyProfileSteam, driver)).pipe(
  Effect.withClock(clock.clock),
  NodeRuntime.runMain,
);
