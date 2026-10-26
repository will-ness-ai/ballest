// `pnpm traffic`: build today's Traffic Report now from whichever halves have their keys in the
// environment (PLAUSIBLE_URL + PLAUSIBLE_API_KEY, GSC_SERVICE_ACCOUNT) and print it; with --post
// it goes to TRAFFIC_WEBHOOK_URL too. It skips the schedule and records nothing, so it is how to
// check the keys and the words before the bot posts at 13:00 UTC.
import { NodeRuntime } from "@effect/platform-node";
import { Clock, Effect, Layer, Option } from "effect";
import { dayOf, daysBefore } from "../src/everyDay.js";
import { half, isSet, TrafficChannel, TrafficChannelLive } from "../src/traffic/daily.js";
import { PlausibleLive, VisitsSource } from "../src/traffic/plausible.js";
import { trafficMessage } from "../src/traffic/report.js";
import { SearchConsoleLive, SearchSource } from "../src/traffic/searchConsole.js";

const post = process.argv.includes("--post");

/** A half's read when `on`, with its source's layer; a missing key there is a crash, not a half. */
const when = <A, E, S>(
  on: boolean,
  read: Effect.Effect<A, E, S>,
  layer: Layer.Layer<S, unknown>,
) => (on ? Option.some(read.pipe(Effect.provide(Layer.orDie(layer)))) : Option.none());

const program = Effect.gen(function* () {
  const at = yield* Clock.currentTimeMillis;
  const visits = yield* half(
    when(
      (yield* isSet("PLAUSIBLE_URL")) && (yield* isSet("PLAUSIBLE_API_KEY")),
      Effect.flatMap(VisitsSource, (s) => s.read(daysBefore(dayOf(at), 1))),
      PlausibleLive,
    ),
  );
  const search = yield* half(
    when(
      yield* isSet("GSC_SERVICE_ACCOUNT"),
      Effect.flatMap(SearchSource, (s) => s.read(at)),
      SearchConsoleLive,
    ),
  );
  const message = trafficMessage(visits, search);
  console.log(message);
  if (post)
    yield* Effect.flatMap(TrafficChannel, (c) => c.post(message)).pipe(
      Effect.provide(TrafficChannelLive),
    );
});

NodeRuntime.runMain(program);
