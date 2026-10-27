// PROTOTYPE (branch claude/prototype-cup-standings): post the Weekly Cup's standings variants A to
// E (src/weeklyCup/standingsVariants.ts) into the sandbox channel, as the dev bot, and print each
// message's link. `pnpm sandbox` need not be running; the channel comes from `axi sandbox create`.
import { NodeRuntime } from "@effect/platform-node";
import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { Effect } from "effect";
import { Renderer } from "../src/render/renderer.js";
import {
  sample,
  variantA,
  variantB,
  variantC,
  variantD,
  variantDImage,
  variantE,
} from "../src/weeklyCup/standingsVariants.js";
import { devEnvFile } from "./devEnv.js";
import { readSandbox } from "./sandbox/config.js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(devEnvFile(), "utf8")
    .split(/\r?\n/)
    .flatMap((l) => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
      return m === null ? [] : [[m[1], m[2]]];
    }),
) as Record<string, string>;

const program = Effect.gen(function* () {
  const sandbox = readSandbox();
  if (sandbox === null)
    return yield* Effect.dieMessage("no sandbox channel: pnpm axi sandbox create");
  const s = sample();
  const png = yield* (yield* Renderer).cupStandings(variantDImage(s));
  const posts = [
    ["A", variantA(s)],
    ["B", variantB(s)],
    ["C", variantC(s)],
    ["D", variantD(s, png)],
    ["E", variantE(s)],
  ] as const;
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  yield* Effect.promise(() => client.login(env.DISCORD_TOKEN));
  const channel = (yield* Effect.promise(() =>
    client.channels.fetch(sandbox.channelId),
  )) as TextChannel;
  for (const [letter, payloads] of posts)
    for (const payload of payloads) {
      const m = yield* Effect.tryPromise(() => channel.send(payload));
      console.log(`${letter}: ${m.url}`);
    }
  yield* Effect.promise(() => client.destroy());
});

program.pipe(Effect.provide(Renderer.Default), NodeRuntime.runMain);
