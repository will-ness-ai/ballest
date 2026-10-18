// The Daily Post's real adapters: the developers' Daily API, the bot's own Steam session and the
// Steam Web API, and the daily challenge channel over Discord's REST API (like the Daily Report's,
// so `pnpm daily-post` can post without logging a second copy of the bot in).
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { PermissionFlagsBits, REST, type RequestData, Routes } from "discord.js";
import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import { describeDiscordError, Discord, oneLine } from "../discord/client.js";
import { OpsAlerts } from "../ops.js";
import { SteamUnavailable } from "../ports.js";
import { SteamSession } from "../steam/session.js";
import { WebApi } from "../steam/webApi.js";
import type { Challenge } from "./card.js";
import {
  DailyApi,
  DailyApiUnavailable,
  DailyChannel,
  DailyPostFailed,
  DailyPostLogLive,
  dailyPostLoop,
  DailySteam,
  DailyThreadFailed,
} from "./schedule.js";
import { DailySpinsLive } from "./spin.js";

// ---------------------------------------------------------------- the Daily API

/** The API's answer for a date. Captured 2026-10-18 for "2026-10-18": found, with the
 * challenge; for the next day, before it opened: {"ok":true,"found":false,"challenge":null}. */
const DailyAnswer = Schema.Struct({
  found: Schema.Boolean,
  challenge: Schema.NullOr(
    Schema.Struct({
      date: Schema.String,
      published_file_id: Schema.String,
      level_display_name: Schema.String,
      starts_at: Schema.String,
      ends_at: Schema.String,
      leaderboard_id: Schema.String,
    }),
  ),
});

/**
 * GET `${BALLEST_DAILY_URL}${date}` with the key in the BallestAPIKey header. The URL and the
 * key are secrets: neither is ever logged, so a failure names only its kind and status.
 */
export const DailyApiLive = Layer.effect(
  DailyApi,
  Effect.gen(function* () {
    const url = yield* Config.redacted("BALLEST_DAILY_URL");
    const key = yield* Config.redacted("BALLEST_API_KEY");
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    return DailyApi.of({
      find: Effect.fn("DailyApi.find")(function* (date: string) {
        const answer = yield* http
          .execute(
            HttpClientRequest.get(`${Redacted.value(url)}${date}`).pipe(
              HttpClientRequest.setHeader("BallestAPIKey", Redacted.value(key)),
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(DailyAnswer)),
            Effect.scoped,
            Effect.timeout("20 seconds"),
            Effect.mapError(
              (e) =>
                new DailyApiUnavailable({
                  reason:
                    e._tag === "ResponseError"
                      ? `the API said ${e.response.status}`
                      : e._tag === "ParseError"
                        ? "an answer it couldn't read"
                        : e._tag === "TimeoutException"
                          ? "no answer in 20 seconds"
                          : "no answer",
                }),
            ),
          );
        const c = answer.challenge;
        if (!answer.found || c === null) return Option.none<Challenge>();
        const challenge: Challenge = {
          date: c.date,
          pfid: c.published_file_id,
          title: c.level_display_name,
          startsAt: Date.parse(c.starts_at),
          endsAt: Date.parse(c.ends_at),
          boardId: Number(c.leaderboard_id),
        };
        if (![challenge.startsAt, challenge.endsAt, challenge.boardId].every(Number.isFinite))
          return yield* new DailyApiUnavailable({ reason: "an answer it couldn't read" });
        return Option.some(challenge);
      }),
    });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));

// ---------------------------------------------------------------- Steam

/** The Daily's Map from the Web API, and its board from the bot's own session (one request). */
export const DailySteamLive = Layer.effect(
  DailySteam,
  Effect.gen(function* () {
    const session = yield* SteamSession;
    const web = yield* WebApi;
    return DailySteam.of({
      map: Effect.fn("DailySteam.map")(function* (pfid: string) {
        const map = yield* web.workshopMap(pfid);
        if (Option.isNone(map))
          return yield* new SteamUnavailable({ reason: `no Ballest Map ${pfid} on the Workshop` });
        const { title, creator, previewUrl, medals } = map.value;
        return { title, maker: creator, previewUrl, medals };
      }),
      board: Effect.fn("DailySteam.board")(function* (boardId: number) {
        const { count, entries } = yield* session.range(boardId, 1, 3);
        const names = new Map(
          (yield* web.summaries(entries.map((e) => e.steamId))).map((s) => [
            s.steamid,
            s.personaname,
          ]),
        );
        return {
          players: count,
          top: entries.map((e) => ({ name: names.get(e.steamId) ?? e.steamId, ticks: e.score })),
        };
      }),
    });
  }),
).pipe(Layer.provide(Layer.merge(SteamSession.Default, WebApi.Default)));

// ---------------------------------------------------------------- the channel

const Created = Schema.Struct({ id: Schema.String });

/** Each file a Components V2 message shows: its media's attachment id, and its file's name. */
const attachedTo = (message: unknown): Array<{ id: string; filename: string }> => {
  const found = new Map<string, string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === "object" && node !== null) {
      const { attachment_id: id, url } = node as Record<string, unknown>;
      if (typeof id === "string" && typeof url === "string")
        found.set(id, decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? ""));
      Object.values(node).forEach(walk);
    }
  };
  walk((message as { components?: unknown }).components);
  return [...found].map(([id, filename]) => ({ id, filename }));
};

/** DAILY_CHANNEL_ID over REST with the bot's token. */
export const DailyChannelLive = Layer.effect(
  DailyChannel,
  Effect.gen(function* () {
    const token = yield* Config.redacted("DISCORD_TOKEN");
    const channelId = yield* Config.string("DAILY_CHANNEL_ID");
    const rest = new REST({ version: "10" }).setToken(Redacted.value(token));
    const call = (op: string, run: () => Promise<unknown>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) => new DailyPostFailed({ reason: `${op}: ${oneLine(cause)}` }),
      });
    /** A REST call that creates a message or thread: the new id, read from Discord's reply. */
    const create = (
      op: string,
      route: `/${string}`,
      options: Omit<RequestData, "body"> & { readonly body: object },
    ) =>
      call(op, () => rest.post(route, options)).pipe(
        Effect.flatMap(Schema.decodeUnknown(Created)),
        Effect.map((created) => created.id),
        Effect.catchTag("ParseError", () =>
          Effect.fail(new DailyPostFailed({ reason: `${op}: Discord's reply had no id` })),
        ),
      );
    return DailyChannel.of({
      post: Effect.fn("DailyChannel.post")(function* (message, files, threadName) {
        const messageId = yield* create("post the card", Routes.channelMessages(channelId), {
          body: message,
          files: files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })),
        });
        const threadId = yield* create("start the thread", Routes.threads(channelId, messageId), {
          body: { name: threadName, auto_archive_duration: 1440 },
        }).pipe(
          Effect.catchTag("DailyPostFailed", (e) =>
            Effect.fail(new DailyThreadFailed({ messageId, reason: e.reason })),
          ),
        );
        return { messageId, threadId };
      }),
      edit: Effect.fn("DailyChannel.edit")(function* (messageId, message, files = []) {
        const route = Routes.channelMessage(channelId, messageId);
        if (files.length === 0) {
          yield* call("edit the card", () => rest.patch(route, { body: message }));
          return;
        }
        // An edit that attaches a file names every attachment the card keeps, or Discord drops
        // the ones left out: the ones it has, then the new ones by their index. A Components V2
        // message lists none under `attachments`: each one is in the component that shows it.
        const kept = attachedTo(yield* call("read the card", () => rest.get(route)));
        yield* call("edit the card", () =>
          rest.patch(route, {
            body: {
              ...message,
              attachments: [...kept, ...files.map((f, i) => ({ id: i, filename: f.name }))],
            },
            files: files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })),
          }),
        );
      }),
    });
  }),
);

// ---------------------------------------------------------------- the feature

/** What the bot's role needs in the daily challenge channel. */
const REQUIRED: ReadonlyArray<readonly [string, bigint]> = [
  ["View Channel", PermissionFlagsBits.ViewChannel],
  ["Send Messages", PermissionFlagsBits.SendMessages],
  ["Embed Links", PermissionFlagsBits.EmbedLinks],
  ["Attach Files", PermissionFlagsBits.AttachFiles],
  ["Create Public Threads", PermissionFlagsBits.CreatePublicThreads],
  ["Send Messages in Threads", PermissionFlagsBits.SendMessagesInThreads],
];

/**
 * The Daily Post, on when DAILY_CHANNEL_ID, BALLEST_API_KEY and BALLEST_DAILY_URL are all set and
 * the bot has its permissions in that channel; otherwise it says why and the bot runs on.
 */
export const DailyPostLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const channel = yield* Config.option(Config.string("DAILY_CHANNEL_ID"));
    const key = yield* Config.option(Config.redacted("BALLEST_API_KEY"));
    const url = yield* Config.option(Config.redacted("BALLEST_DAILY_URL"));
    if (Option.isNone(channel) || Option.isNone(key) || Option.isNone(url)) {
      yield* Effect.logInfo(
        "daily post: off (DAILY_CHANNEL_ID, BALLEST_API_KEY or BALLEST_DAILY_URL not set)",
      );
      return Layer.empty;
    }
    return Layer.scopedDiscard(
      Effect.gen(function* () {
        const discord = yield* Discord;
        const missing = yield* discord.missingIn(channel.value, REQUIRED);
        if (missing.length > 0)
          return yield* Effect.logWarning(
            `daily post: off (the bot is missing ${missing.join(", ")} in ${channel.value})`,
          );
        yield* Effect.logInfo(`daily post: posting in ${channel.value}`);
        yield* Effect.forkScoped(dailyPostLoop);
      }).pipe(
        Effect.catchTag("DiscordError", (e) =>
          Effect.logWarning(`daily post: off (${describeDiscordError(e)})`),
        ),
      ),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          DailyApiLive,
          DailySteamLive,
          DailyChannelLive,
          DailyPostLogLive,
          DailySpinsLive,
          OpsAlerts.Default,
        ),
      ),
    );
  }),
);
