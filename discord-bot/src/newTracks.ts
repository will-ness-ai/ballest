// New Workshop Maps on the site within minutes (spec #259). The game Discord's #new-tracks gets a
// post from the HubUpdates app within seconds of each Map going up on the Workshop. A minute after
// a post, the bot asks the collector's service on Fly (tools/runner.py, ADR 0012) to add them,
// over Fly's private network; it writes only the new Maps to the leaderboard database, then
// downloads their files. Posts in that minute share the request. The bot never reads the posts:
// any message there counts, and the collector finds what is new.
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Config, Context, Data, Duration, Effect, Layer, Option, Ref, Stream } from "effect";
import { describeDiscordError, Discord } from "./discord/client.js";
import { OpsAlerts } from "./ops.js";

/** How long after a post the step starts, so a burst of posts makes one run. */
export const WAIT_AFTER_POST = Duration.toMillis("1 minute");

/** How long the collector has to take a request: it queues the job and answers at once. */
export const ADD_MAPS_TIMEOUT = Duration.toMillis("30 seconds");

export class AddMapsFailed extends Data.TaggedError("AddMapsFailed")<{
  readonly reason: string;
}> {}

/** Asks the collector to add the Workshop's new Maps. */
export class AddMaps extends Context.Tag("multiballs/AddMaps")<
  AddMaps,
  { readonly start: Effect.Effect<void, AddMapsFailed> }
>() {}

/** The collector's service at `url` (no secret: it has no public address). It queues the job
 * and answers at once; a failed add reaches the ops channel from the collector itself. */
export const addMapsLive = (url: string) =>
  Layer.effect(
    AddMaps,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      return AddMaps.of({
        start: http.execute(HttpClientRequest.post(`${url}/add-maps`)).pipe(
          Effect.scoped,
          Effect.asVoid,
          Effect.mapError(
            (e) =>
              new AddMapsFailed({
                reason:
                  e._tag === "ResponseError"
                    ? `the collector said ${e.response.status}`
                    : e.message,
              }),
          ),
          Effect.timeoutFail({
            duration: ADD_MAPS_TIMEOUT,
            onTimeout: () => new AddMapsFailed({ reason: "the collector didn't answer" }),
          }),
        ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** For every post, the step a minute later, unless one is already waiting to start. */
export const newTracksLoop = Effect.fn("NewTracks.loop")(function* (posts: Stream.Stream<string>) {
  const addMaps = yield* AddMaps;
  const alerts = yield* OpsAlerts;
  const waiting = yield* Ref.make(false);
  const run = Effect.sleep(WAIT_AFTER_POST).pipe(
    Effect.zipRight(Ref.set(waiting, false)),
    Effect.zipRight(addMaps.start),
    Effect.tap(() => Effect.logInfo("new tracks: started adding new Maps")),
    Effect.catchTag("AddMapsFailed", (e) =>
      alerts.post(`Multiballs couldn't start adding a new Workshop Map: ${e.reason}`),
    ),
  );
  yield* Stream.runForEach(posts, () =>
    Effect.gen(function* () {
      if (yield* Ref.getAndSet(waiting, true)) return;
      yield* Effect.forkScoped(run);
    }),
  );
}, Effect.scoped);

/** The listener, on when NEW_TRACKS_CHANNEL_ID and COLLECTOR_URL are both set and the bot can
 * view that channel; otherwise it says why and the bot runs on without it. */
export const NewTracksLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const channel = yield* Config.option(Config.string("NEW_TRACKS_CHANNEL_ID"));
    const collector = yield* Config.option(Config.string("COLLECTOR_URL"));
    if (Option.isNone(channel) || Option.isNone(collector)) {
      yield* Effect.logInfo("new tracks: off (NEW_TRACKS_CHANNEL_ID or COLLECTOR_URL not set)");
      return Layer.empty;
    }
    return Layer.scopedDiscard(
      Effect.gen(function* () {
        const discord = yield* Discord;
        const posts = yield* discord.postsIn(channel.value);
        yield* Effect.logInfo(`new tracks: listening in ${channel.value}`);
        yield* Effect.forkScoped(newTracksLoop(posts));
      }).pipe(
        Effect.catchTag("DiscordError", (e) =>
          Effect.logWarning(`new tracks: off (${describeDiscordError(e)})`),
        ),
      ),
    ).pipe(Layer.provide(Layer.mergeAll(addMapsLive(collector.value), OpsAlerts.Default)));
  }),
);
