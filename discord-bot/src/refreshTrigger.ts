// Starts the leaderboard Refresh (.github/workflows/refresh.yml) on time. GitHub delays and skips
// scheduled runs, often by hours, but runs a workflow_dispatch straight away, so the bot's clock
// starts it instead: every three hours, and at 15:30 UTC so the 16:00 Daily Report (src/report/)
// has fresh numbers. The workflow keeps a slower schedule of its own for when the bot is down.
// Off unless GITHUB_DISPATCH_TOKEN is set: a fine-grained token for will-ness-ai/ballest with
// Actions read and write, and nothing else.
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Clock, Config, Effect, Layer, Option, Redacted } from "effect";
import { OpsAlerts } from "./ops.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WORKFLOW_URL =
  "https://api.github.com/repos/will-ness-ai/ballest/actions/workflows/refresh.yml/dispatches";

/** When a Refresh starts, in minutes after midnight UTC: every three hours, and 15:30. */
export const REFRESH_TIMES = [0, 180, 360, 540, 720, 900, 930, 1080, 1260];

/** The next time a Refresh should start, strictly after `now`. */
export const nextRefreshAt = (now: number) => {
  const midnight = now - (now % DAY_MS);
  const today = REFRESH_TIMES.map((m) => midnight + m * MINUTE_MS).find((t) => t > now);
  return today ?? midnight + DAY_MS + (REFRESH_TIMES[0] ?? 0) * MINUTE_MS;
};

/** Ask GitHub to run the refresh workflow on main now. */
export const startRefresh = Effect.fn("startRefresh")(function* (token: Redacted.Redacted) {
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  yield* http
    .execute(
      HttpClientRequest.post(WORKFLOW_URL).pipe(
        HttpClientRequest.bearerToken(Redacted.value(token)),
        HttpClientRequest.setHeaders({
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        }),
        HttpClientRequest.bodyUnsafeJson({ ref: "main" }),
      ),
    )
    .pipe(Effect.scoped);
  yield* Effect.logInfo("refresh trigger: started a Refresh");
});

export const RefreshTriggerLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const token = yield* Config.option(Config.redacted("GITHUB_DISPATCH_TOKEN"));
    if (Option.isNone(token)) {
      yield* Effect.logInfo("refresh trigger: off (GITHUB_DISPATCH_TOKEN not set)");
      return Layer.empty;
    }
    return Layer.scopedDiscard(
      Effect.gen(function* () {
        const alerts = yield* OpsAlerts;
        const loop = Effect.gen(function* () {
          while (true) {
            const now = yield* Clock.currentTimeMillis;
            yield* Effect.sleep(nextRefreshAt(now) - now);
            yield* startRefresh(token.value).pipe(
              Effect.catchAll((e) =>
                alerts.post(`Multiballs couldn't start the leaderboard Refresh: ${e._tag}`),
              ),
            );
          }
        });
        yield* Effect.forkScoped(loop);
      }),
    ).pipe(Layer.provide(Layer.merge(FetchHttpClient.layer, OpsAlerts.Default)));
  }),
);
