// New Workshop Maps on the site within minutes (spec #259). The game Discord's #new-tracks gets a
// post from the HubUpdates app within seconds of each Map going up on the Workshop. A minute after
// a post, the bot starts the site's add-maps workflow (.github/workflows/add-maps.yml), which
// writes only the new Maps to the leaderboard database; posts in that minute share the run. The
// bot never reads the posts: any message there counts, and the workflow finds what is new.
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import {
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Stream,
} from "effect";
import { describeDiscordError, Discord } from "./discord/client.js";
import { OpsAlerts } from "./ops.js";

/** How long after a post the step starts, so a burst of posts makes one run. */
export const BATCH = Duration.toMillis("1 minute");

const WORKFLOW =
  "https://api.github.com/repos/will-ness-ai/ballest/actions/workflows/add-maps.yml/dispatches";

export class AddMapsFailed extends Data.TaggedError("AddMapsFailed")<{
  readonly reason: string;
}> {}

/** Starts the add-maps workflow. */
export class AddMaps extends Context.Tag("multiballs/AddMaps")<
  AddMaps,
  { readonly start: Effect.Effect<void, AddMapsFailed> }
>() {}

/** The workflow on main, through GitHub's API, with a token that may run this repo's Actions. */
const addMapsLive = (token: Redacted.Redacted) =>
  Layer.effect(
    AddMaps,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
      return AddMaps.of({
        start: http
          .execute(
            HttpClientRequest.post(WORKFLOW).pipe(
              HttpClientRequest.bearerToken(Redacted.value(token)),
              HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
              HttpClientRequest.bodyUnsafeJson({ ref: "main" }),
            ),
          )
          .pipe(
            Effect.scoped,
            Effect.asVoid,
            Effect.mapError(
              (e) =>
                new AddMapsFailed({
                  reason:
                    e._tag === "ResponseError" ? `GitHub said ${e.response.status}` : e.message,
                }),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** For every post, the step a minute later, unless one is already waiting to start. */
export const newTracksLoop = (posts: Stream.Stream<string>) =>
  Effect.gen(function* () {
    const addMaps = yield* AddMaps;
    const alerts = yield* OpsAlerts;
    const waiting = yield* Ref.make(false);
    const run = Effect.sleep(BATCH).pipe(
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
  }).pipe(Effect.scoped);

/** The listener, on when NEW_TRACKS_CHANNEL_ID and GITHUB_DISPATCH_TOKEN are both set and the
 * bot can view that channel; otherwise it says why and the bot runs on without it. */
export const NewTracksLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const channel = yield* Config.option(Config.string("NEW_TRACKS_CHANNEL_ID"));
    const token = yield* Config.option(Config.redacted("GITHUB_DISPATCH_TOKEN"));
    if (Option.isNone(channel) || Option.isNone(token)) {
      yield* Effect.logInfo(
        "new tracks: off (NEW_TRACKS_CHANNEL_ID or GITHUB_DISPATCH_TOKEN not set)",
      );
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
    ).pipe(Layer.provide(Layer.mergeAll(addMapsLive(token.value), OpsAlerts.Default)));
  }),
);
