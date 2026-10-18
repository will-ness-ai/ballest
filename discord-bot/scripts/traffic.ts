// `pnpm traffic`: build today's Traffic Report now from whichever halves have their keys in the
// environment (PLAUSIBLE_URL + PLAUSIBLE_API_KEY, GSC_SERVICE_ACCOUNT) and print it; with --post
// it goes to TRAFFIC_WEBHOOK_URL too. It skips the schedule and records nothing, so it is how to
// check the keys and the words before the bot posts at 13:00 UTC.
import { NodeRuntime } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Clock, Config, Effect, Layer, Option } from "effect";
import { dayOf } from "../src/everyDay.js";
import { TrafficChannel, TrafficChannelLive } from "../src/traffic/daily.js";
import {
  daysBefore,
  PlausibleLive,
  TrafficUnavailable,
  VisitsSource,
} from "../src/traffic/plausible.js";
import { type Half, type Search, trafficMessage, type Visits } from "../src/traffic/report.js";
import { SearchConsoleLive, SearchSource } from "../src/traffic/searchConsole.js";

const post = process.argv.includes("--post");

const half = <A, E>(read: Effect.Effect<A, E>): Effect.Effect<Half<A>> =>
  read.pipe(
    Effect.map((value): Half<A> => ({ _tag: "Ok", value })),
    Effect.catchAll((e) =>
      Effect.succeed<Half<A>>({
        _tag: "Failed",
        reason: e instanceof TrafficUnavailable ? e.reason : String(e),
      }),
    ),
  );

const set = (name: string) => Config.option(Config.string(name)).pipe(Effect.map(Option.isSome));

const program = Effect.gen(function* () {
  const at = yield* Clock.currentTimeMillis;
  const visits: Half<Visits> =
    (yield* set("PLAUSIBLE_URL")) && (yield* set("PLAUSIBLE_API_KEY"))
      ? yield* half(
          Effect.flatMap(VisitsSource, (s) => s.read(daysBefore(dayOf(at), 1))).pipe(
            Effect.provide(PlausibleLive),
          ),
        )
      : { _tag: "Off" };
  const search: Half<Search> = (yield* set("GSC_SERVICE_ACCOUNT"))
    ? yield* half(
        Effect.flatMap(SearchSource, (s) => s.read(at)).pipe(Effect.provide(SearchConsoleLive)),
      )
    : { _tag: "Off" };
  const message = trafficMessage(visits, search);
  console.log(message);
  if (post)
    yield* Effect.flatMap(TrafficChannel, (c) => c.post(message)).pipe(
      Effect.provide(
        TrafficChannelLive.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))),
      ),
    );
});

NodeRuntime.runMain(program);
