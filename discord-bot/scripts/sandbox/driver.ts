// The sandbox's driver: a local HTTP API (127.0.0.1 only) that clicks the bot's buttons, picks
// from its menus and submits its forms as any member, and sets fake Steam times. Discord only
// lets people press an app's buttons (a bot can't), so the driver hands the bot a stand-in for
// discord.js's Interaction instead: everything from InteractionsLive inwards runs as it would
// for a real click, and what the bot answers privately is recorded and returned, since nobody
// else can see an ephemeral reply. What it changes in the channel goes to Discord for real.
// It also moves the sandbox's clock forward (`/clock`) and sets a time on any Map (`/run`), for
// the Weekly Cup.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
// Forward slashes on Windows too: the paths are printed for agents, and Node takes them as they are.
import { posix } from "node:path";
import type { Interaction } from "discord.js";
import { Effect, Layer, Option, Queue, Runtime, Stream } from "effect";
import { Discord } from "../../src/discord/client.js";
import { DriverInteractions } from "../../src/discord/interactions.js";
import { Store } from "../../src/ports.js";
import type { FakeSteamControl } from "../../test/harness.js";
import type { DevClock } from "./clock.js";
import { type ApiMessage, filesOf, fromPayload } from "../axi/describe.js";
import { LOGS } from "./config.js";

export type Kind = "button" | "select" | "modal";

export interface Press {
  readonly kind: Kind;
  readonly customId: string;
  /** The member's Discord id. */
  readonly as: string;
  /** A select's picks. */
  readonly values?: ReadonlyArray<string>;
  /** A form's fields, by input custom id. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Whether the member holds Manage Server (the Weekly Cup's Skip); no unless told. */
  readonly manageServer?: boolean;
}

/** One call the bot made on the interaction, in order. */
export interface Call {
  readonly method: string;
  readonly payload?: unknown;
}

/** How long the bot may stay quiet before an interaction counts as handled. */
const SETTLE_MS = 1500;
const FIRST_CALL_MS = 5000;
const LIMIT_MS = 30_000;

/**
 * A stand-in for the discord.js Interaction, with just what InteractionsLive uses. Every reply
 * method records its payload; `settled` resolves once the bot has gone quiet.
 */
export const fakeInteraction = (press: Press, channelId: string) => {
  const calls: Array<Call> = [];
  // Replaced once `settled` starts its timer; a call before that has nothing to wake.
  let poke: () => void = () => undefined;
  const record = (method: string) => (payload?: unknown) => {
    calls.push(payload === undefined ? { method } : { method, payload });
    poke();
    return Promise.resolve(undefined);
  };
  const interaction = {
    id: `driver-${Date.now()}`,
    customId: press.customId,
    user: { id: press.as, username: press.as },
    channelId,
    channel: null,
    guildId: null,
    memberPermissions: { has: () => press.manageServer === true },
    values: press.values ?? [],
    fields: {
      getTextInputValue: (id: string) => {
        const v = press.fields?.[id];
        if (v === undefined) throw new Error(`no value for form field ${id}`);
        return v;
      },
    },
    isButton: () => press.kind === "button",
    // A select is either kind: the bot tells them apart by the custom id.
    isUserSelectMenu: () => press.kind === "select",
    isStringSelectMenu: () => press.kind === "select",
    isModalSubmit: () => press.kind === "modal",
    isRepliable: () => true,
    reply: record("reply"),
    update: record("update"),
    deferUpdate: record("deferUpdate"),
    deferReply: record("deferReply"),
    editReply: record("editReply"),
    followUp: record("followUp"),
    showModal: record("showModal"),
  };
  const settled = new Promise<ReadonlyArray<Call>>((resolve) => {
    const started = Date.now();
    let timer = setTimeout(() => resolve(calls), FIRST_CALL_MS);
    poke = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => resolve(calls),
        Math.min(SETTLE_MS, Math.max(0, LIMIT_MS - (Date.now() - started))),
      );
    };
  });
  return { interaction: interaction as unknown as Interaction, settled };
};

const body = (req: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
    req.on("end", () => {
      try {
        resolve(data === "" ? {} : JSON.parse(data));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });

/** A recorded call as the CLI reads it: the message it showed, and its images saved to disk. */
export interface Answer {
  readonly method: string;
  readonly message: ApiMessage | null;
  readonly files: Readonly<Record<string, string>>;
}

const REPLIES = posix.join(LOGS, "axi", "replies");
let saved = 0;

const answerOf = (call: Call): Answer => {
  if (call.payload === undefined) return { method: call.method, message: null, files: {} };
  const files: Record<string, string> = {};
  if (typeof call.payload === "object" && call.payload !== null)
    for (const f of filesOf(call.payload as Record<string, unknown>)) {
      if (f.data === null) continue;
      mkdirSync(REPLIES, { recursive: true });
      const path = posix.join(REPLIES, `${++saved}-${f.name}`);
      writeFileSync(path, f.data);
      files[f.name] = path;
    }
  return { method: call.method, message: fromPayload(call.method, call.payload), files };
};

const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

/** The driver: its interaction feed for the bot, and its HTTP API on `port`. */
export const makeDriver = (opts: {
  readonly port: number;
  readonly channelId: string;
  readonly steam: FakeSteamControl;
  readonly clock: DevClock;
  /** The fake catalogue, to find a Map by its title. */
  readonly maps: ReadonlyArray<{ readonly title: string; readonly boardId: number | null }>;
}) => {
  const queue = Effect.runSync(Queue.unbounded<Interaction>());
  // Its clicks play in the home Venue: the sandbox channel is home's.
  const feed = Layer.effect(
    DriverInteractions,
    Effect.map(Discord, (discord) =>
      Stream.fromQueue(queue).pipe(
        Stream.map((interaction) => ({ interaction, venue: discord.home })),
      ),
    ),
  );

  const server = Layer.scopedDiscard(
    Effect.gen(function* () {
      const store = yield* Store;
      const run = Runtime.runPromise(yield* Effect.runtime());

      const interact = async (press: Press) => {
        const { interaction, settled } = fakeInteraction(press, opts.channelId);
        await run(Queue.offer(queue, interaction));
        return { answers: (await settled).map(answerOf) };
      };

      /** A finished run on the Match's Map, as the member's linked Steam account. */
      const setTime = (matchId: string, as: string, seconds: number) =>
        Effect.gen(function* () {
          const match = yield* store.getMatch(matchId);
          if (Option.isNone(match) || match.value.map === null)
            return { error: `Match ${matchId} has no drawn Map (not live yet?)` };
          const link = yield* store.getLink(as);
          if (Option.isNone(link)) return { error: `member ${as} has not linked Steam` };
          yield* opts.steam.setTime(match.value.map.boardId, link.value.steamId, seconds);
          return {
            ok: `set ${seconds}s for ${link.value.personaName} on ${match.value.map.title}; the engine reads it on its next poll`,
          };
        });

      /** A finished run on any Map (by title or board id), as the member's linked Steam account. */
      const setRun = (map: string, as: string, seconds: number) =>
        Effect.gen(function* () {
          const found = opts.maps.find(
            (m) => m.title.toLowerCase() === map.toLowerCase() || String(m.boardId) === map,
          );
          if (found?.boardId == null)
            return { error: `no Map "${map}": ${opts.maps.map((m) => m.title).join(", ")}` };
          const link = yield* store.getLink(as);
          if (Option.isNone(link)) return { error: `member ${as} has not linked Steam` };
          yield* opts.steam.setTime(found.boardId, link.value.steamId, seconds);
          return { ok: `set ${seconds}s for ${link.value.personaName} on ${found.title}` };
        });

      const clockNow = () => ({ now: new Date(opts.clock.now()).toISOString() });

      const handle = async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (req.method === "GET" && req.url === "/health") {
            const matches = await run(store.activeMatches);
            return send(res, 200, {
              channelId: opts.channelId,
              matches: matches.map((m) => ({
                id: m.id,
                state: m.state,
                type: m.type,
                players: m.players.map((p) => p.discordId),
                map: m.map?.title ?? null,
              })),
            });
          }
          const input = (await body(req)) as Record<string, unknown>;
          if (req.method === "POST" && req.url === "/interact")
            return send(res, 200, await interact(input as unknown as Press));
          if (req.method === "POST" && req.url === "/time")
            return send(
              res,
              200,
              await run(setTime(String(input.matchId), String(input.as), Number(input.seconds))),
            );
          if (req.method === "GET" && req.url === "/clock") return send(res, 200, clockNow());
          if (req.method === "POST" && req.url === "/clock") {
            const to = Date.parse(String(input.to));
            if (Number.isNaN(to))
              return send(res, 400, { error: `not a time: ${String(input.to)}` });
            opts.clock.jump(to);
            return send(res, 200, clockNow());
          }
          if (req.method === "POST" && req.url === "/run")
            return send(
              res,
              200,
              await run(setRun(String(input.map), String(input.as), Number(input.seconds))),
            );
          if (req.method === "POST" && req.url === "/steam") {
            const down = input.down === true;
            // Every read fails while down, as when Steam stops answering; up clears it.
            await run(opts.steam.failNextReads(down ? Number.MAX_SAFE_INTEGER : 0));
            return send(res, 200, {
              ok: down ? "fake Steam is down: every read fails" : "fake Steam is up again",
            });
          }
          return send(res, 404, { error: `no route ${req.method} ${req.url}` });
        } catch (e) {
          return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      };

      yield* Effect.acquireRelease(
        Effect.async<ReturnType<typeof createServer>, Error>((resume) => {
          const s = createServer((req, res) => void handle(req, res));
          s.once("error", (e) => resume(Effect.fail(e)));
          s.listen(opts.port, "127.0.0.1", () => resume(Effect.succeed(s)));
        }),
        (s) =>
          Effect.async<undefined>((resume) => {
            s.close(() => resume(Effect.succeed(undefined)));
          }),
      );
      yield* Effect.log(`sandbox driver on http://127.0.0.1:${opts.port}`);
    }),
  );
  return { feed, server };
};
