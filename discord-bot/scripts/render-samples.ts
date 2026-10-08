// `pnpm render:samples [dir]`: renders every image the bot draws, in every state, as PNGs (to
// the gitignored `.logs/samples` by default) to check by eye against the prototype (branch claude/prototype-discord-bot-surfaces).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { type Player, SCORE_TICKS_PER_SECOND, type Standing } from "../src/domain.js";
import type { CardView } from "../src/ports.js";
import { Renderer } from "../src/render/renderer.js";

const out = process.argv[2] ?? ".logs/samples";
const T = SCORE_TICKS_PER_SECOND;
const p = (name: string): Player => ({
  discordId: name,
  steamId: `7656119800${name.length}${name.charCodeAt(0)}${name.charCodeAt(1)}`,
});
const [chkn, tilt, grav, maxx] = [
  p("ChknThugget"),
  p("tilt_queen"),
  p("gravwell"),
  p("シドニー"),
] as const;
const names = new Map([chkn, tilt, grav, maxx].map((x) => [x.discordId, x.discordId]));
const map = {
  pfid: "3791550212",
  title: "Gutter Run",
  creator: "pebblewright",
  previewUrl: "",
  boardName: "",
  medals: { bronze: 20, silver: 17, gold: 15.5, author: 14.2 },
  boardId: 1,
  worldRecordTicks: 12.981 * T,
  personalBests: {},
};
const standing = (
  player: Player,
  seconds: number | null,
  rank: number | null,
  medal: Standing["medal"],
): Standing => ({
  player,
  ticks: seconds === null ? null : Math.round(seconds * T),
  rank,
  medal,
});
const base: CardView = {
  matchId: "1",
  state: "invite",
  type: "lobby",
  minutes: 15,
  creator: chkn,
  target: null,
  players: [chkn, tilt, grav],
  map: null,
  standings: [],
  expiresAt: null,
  endsAt: null,
  waitingForSteam: false,
};
const cards: Record<string, CardView> = {
  "card-invite-lobby": base,
  "card-invite-public": { ...base, type: "public", players: [chkn] },
  "card-invite-challenge": { ...base, type: "challenge", players: [chkn], target: tilt },
  "card-live-lobby": {
    ...base,
    state: "live",
    players: [chkn, tilt, grav, maxx],
    // シドニー had finished this Map before, so only a run under their PB counts
    map: { ...map, personalBests: { [maxx.steamId]: 14.95 * T } },
    standings: [
      standing(grav, 14.59, 1, "gold"),
      standing(chkn, 15.118, 2, "gold"),
      standing(tilt, 16.402, 3, "silver"),
      standing(maxx, null, null, null),
    ],
  },
  "card-final-lobby": {
    ...base,
    state: "finished",
    players: [chkn, tilt, grav, maxx],
    map,
    standings: [
      standing(grav, 13.977, 1, "author"),
      standing(chkn, 14.861, 2, "gold"),
      standing(tilt, 16.402, 3, "silver"),
      standing(maxx, null, null, null),
    ],
  },
  // gravwell beat the 12.981 WR: the WR ribbon replaces their medal
  "card-final-wr": {
    ...base,
    state: "finished",
    players: [chkn, tilt, grav, maxx],
    map,
    standings: [
      standing(grav, 12.94, 1, "author"),
      standing(chkn, 13.2, 2, "author"),
      standing(tilt, 16.402, 3, "silver"),
      standing(maxx, null, null, null),
    ],
  },
};
// Time is up and the Result is waiting for Steam: the live Card, marked as such.
const liveLobby = cards["card-live-lobby"];
if (liveLobby !== undefined) cards["card-waiting-lobby"] = { ...liveLobby, waitingForSteam: true };

/** A 15-minute Lobby's PBs as they happened: seconds into the Match, Player, time. */
const pbs = (events: ReadonlyArray<readonly [number, Player, number]>) =>
  events.map(([s, player, t]) => ({
    steamId: player.steamId,
    ticks: Math.round(t * T),
    at: s * 1000,
  }));
const race = pbs([
  [70, tilt, 19.45],
  [112, chkn, 17.09],
  [150, chkn, 15.66],
  [210, grav, 16.96],
  [265, chkn, 14.89],
  [300, grav, 14.18],
  [375, tilt, 15.75],
  [428, tilt, 14.52],
  [511, grav, 13.31],
  [665, grav, 12.94],
  [728, chkn, 13.2],
  [870, tilt, 14.02],
]);

const program = Effect.gen(function* () {
  const renderer = yield* Renderer;
  yield* Effect.tryPromise(() => mkdir(out, { recursive: true }));
  const save = Effect.fn("save")(function* (name: string, png: Buffer) {
    yield* Effect.tryPromise(() => writeFile(join(out, `${name}.png`), png));
  });
  for (const [name, view] of Object.entries(cards))
    yield* save(name, yield* renderer.card({ view, names, preview: null }));
  yield* save(
    "row-lead",
    yield* renderer.improvement(
      {
        player: grav,
        ticks: 14.59 * T,
        medal: "gold",
        rank: 1,
        previousTicks: 17.244 * T,
        previousRank: 2,
        beatWorldRecord: null,
      },
      "gravwell",
    ),
  );
  yield* save(
    "row-first",
    yield* renderer.improvement(
      {
        player: tilt,
        ticks: 16.402 * T,
        medal: "silver",
        rank: 2,
        previousTicks: null,
        previousRank: null,
        beatWorldRecord: null,
      },
      "tilt_queen",
    ),
  );
  yield* save(
    "row-wr",
    yield* renderer.improvement(
      {
        player: grav,
        ticks: 12.94 * T,
        medal: "author",
        rank: 1,
        previousTicks: 13.31 * T,
        previousRank: 1,
        beatWorldRecord: 12.981 * T,
      },
      "gravwell",
    ),
  );
  const finalWr = cards["card-final-wr"];
  if (finalWr !== undefined) {
    yield* save(
      "progression-wr",
      yield* renderer.progression({ view: finalWr, history: race, names }),
    );
    // シドニー brought a PB into the Match: dotted until beaten (here, never)
    const withPb = { ...finalWr, map: { ...map, personalBests: { [maxx.steamId]: 14.3 * T } } };
    yield* save(
      "progression-pb",
      yield* renderer.progression({ view: withPb, history: race, names }),
    );
  }
  yield* save("footer", yield* renderer.footer);
  yield* save(
    "link",
    yield* renderer.link({
      steamId: "76561198012345678",
      personaName: "ChknThugget",
      avatarUrl: "",
      campaignTracks: 21,
      campaignTrackTotal: 23,
    }),
  );
  yield* save("marble", yield* renderer.marble(96));
  yield* Effect.log(`wrote samples to ${out}`);
});

program.pipe(Effect.provide(Renderer.Default), NodeRuntime.runMain);
