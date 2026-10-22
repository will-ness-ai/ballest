// Production health signals, each off unless configured: a heartbeat to Healthchecks.io, which
// alerts the ops channel when pings stop, and a daily warning to the ops channel's webhook once
// the Steam refresh token is close to expiring (the bot never renews it).
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import {
  Clock,
  Config,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import { Discord } from "./discord/client.js";

const WARN_DAYS = 30;
const DAY_MS = 86_400_000;

const TokenClaims = Schema.parseJson(Schema.Struct({ exp: Schema.Number }));

/** Whole days until a Steam refresh token (a JWT) expires; None if its expiry can't be read. */
export const tokenDaysLeft = (token: string, nowMs: number): Option.Option<number> =>
  Option.fromNullable(token.split(".")[1]).pipe(
    Option.flatMap((payload) =>
      Schema.decodeUnknownOption(TokenClaims)(Buffer.from(payload, "base64url").toString("utf8")),
    ),
    Option.map(({ exp }) => Math.floor((exp * 1000 - nowMs) / DAY_MS)),
  );

/**
 * A message to the private ops channel through its webhook (OPS_WEBHOOK_URL), and always a
 * warning in the log. Posts go out in the order told, one at a time, from a queue a background
 * fiber drains, each with a time limit; a failed one is only logged. Nothing waits on ops hearing,
 * and what is still queued when the bot stops is sent within a few seconds.
 */
export class OpsAlerts extends Effect.Service<OpsAlerts>()("multiballs/OpsAlerts", {
  scoped: Effect.gen(function* () {
    const webhookUrl = yield* Config.option(Config.redacted("OPS_WEBHOOK_URL"));
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const queue = yield* Queue.unbounded<string>();
    const send = (url: string, content: string) =>
      http
        .execute(HttpClientRequest.post(url).pipe(HttpClientRequest.bodyUnsafeJson({ content })))
        .pipe(
          Effect.scoped,
          Effect.timeout("10 seconds"),
          Effect.catchAll((e) => Effect.logWarning(`ops webhook failed: ${e._tag}`)),
        );
    if (Option.isSome(webhookUrl)) {
      const url = Redacted.value(webhookUrl.value);
      // Added before the drain is forked, so it runs after the drain stops: what is left is sent.
      yield* Effect.addFinalizer(() =>
        Queue.takeAll(queue).pipe(
          Effect.flatMap((left) => Effect.forEach(left, (content) => send(url, content))),
          // A finalizer can't be interrupted, so its time limit needs the sends to be.
          Effect.interruptible,
          Effect.timeout("5 seconds"),
          Effect.ignore,
        ),
      );
      // A post under way is finished (within its time limit) before the drain stops: it runs
      // in a fiber of its own, which the drain waits on without being interrupted.
      yield* Effect.uninterruptibleMask((restore) =>
        restore(Queue.take(queue)).pipe(
          Effect.flatMap((content) => Effect.forkDaemon(Effect.interruptible(send(url, content)))),
          Effect.flatMap(Fiber.await),
        ),
      ).pipe(Effect.forever, Effect.forkScoped);
    }
    return {
      configured: Option.isSome(webhookUrl),
      post: Effect.fn("OpsAlerts.post")(function* (content: string) {
        yield* Effect.logWarning(`ops: ${content}`);
        if (Option.isSome(webhookUrl)) yield* Queue.offer(queue, content);
      }),
    };
  }),
  dependencies: [FetchHttpClient.layer],
}) {}

export const OpsLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    // Built only once the bot is logged in, so a copy that dies at startup never pings.
    yield* Discord;
    const heartbeatUrl = yield* Config.option(Config.redacted("HEALTHCHECK_URL"));
    const alerts = yield* OpsAlerts;
    const steamToken = yield* Config.redacted("STEAM_REFRESH_TOKEN");
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const send = (what: string, request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request).pipe(
        Effect.scoped,
        Effect.asVoid,
        Effect.catchAll((e) => Effect.logWarning(`${what} failed: ${e._tag}`)),
      );

    if (Option.isSome(heartbeatUrl)) {
      const ping = send("heartbeat", HttpClientRequest.get(Redacted.value(heartbeatUrl.value)));
      yield* Effect.sleep("1 minute").pipe(
        Effect.zipRight(ping),
        Effect.forever,
        Effect.forkScoped,
      );
    }

    if (alerts.configured) {
      const checkToken = Effect.gen(function* () {
        const days = tokenDaysLeft(Redacted.value(steamToken), yield* Clock.currentTimeMillis);
        if (Option.isNone(days))
          return yield* alerts.post("Multiballs can't read its Steam refresh token's expiry date.");
        if (days.value > WARN_DAYS) return;
        yield* alerts.post(
          days.value < 0
            ? "Multiballs' Steam refresh token has expired. Mint a new one and `fly secrets set STEAM_REFRESH_TOKEN=...`."
            : `Multiballs' Steam refresh token expires in ${days.value} day(s). Mint a new one and \`fly secrets set STEAM_REFRESH_TOKEN=...\`.`,
        );
      });
      yield* checkToken.pipe(Effect.repeat(Schedule.spaced("1 day")), Effect.forkScoped);
    }
  }),
).pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, OpsAlerts.Default)));
