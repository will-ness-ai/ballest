import { HttpClient, HttpClientResponse } from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Fiber, Layer, Option, Ref, TestClock } from "effect";
import { OpsAlerts, tokenDaysLeft } from "../src/ops.js";

const DAY_MS = 86_400_000;
const jwt = (claims: object) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("the Steam refresh token's expiry", () => {
  const now = Date.UTC(2026, 8, 26);

  it("counts whole days left", () => {
    expect(tokenDaysLeft(jwt({ exp: (now + 30.5 * DAY_MS) / 1000 }), now)).toEqual(Option.some(30));
  });

  it("goes negative once expired", () => {
    expect(tokenDaysLeft(jwt({ exp: (now - DAY_MS) / 1000 }), now)).toEqual(Option.some(-1));
  });

  it.each(["not-a-jwt", "a.b.c", jwt({ sub: "no exp" })])("can't read %j", (token) => {
    expect(Option.isNone(tokenDaysLeft(token, now))).toBe(true);
  });
});

describe("telling ops", () => {
  it.effect("never waits on the webhook, which may never answer, nor long when the bot stops", () =>
    Effect.gen(function* () {
      const posted = yield* Ref.make(false);
      const bot = yield* Effect.fork(
        Effect.gen(function* () {
          const alerts = yield* OpsAlerts;
          yield* alerts.post("Multiballs couldn't set up a server");
          yield* alerts.post("and another");
          yield* Ref.set(posted, true);
        }).pipe(
          Effect.provide(OpsAlerts.DefaultWithoutDependencies),
          Effect.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.never),
            ),
          ),
          Effect.withConfigProvider(
            ConfigProvider.fromMap(new Map([["OPS_WEBHOOK_URL", "https://example.invalid/hook"]])),
          ),
        ),
      );
      yield* Effect.repeatN(Effect.yieldNow(), 20);
      expect(yield* Ref.get(posted)).toBe(true);
      // Stopping sends what is left, within a few seconds even if Discord never answers.
      yield* Effect.repeatN(
        TestClock.adjust("1 second").pipe(Effect.zipRight(Effect.repeatN(Effect.yieldNow(), 5))),
        15,
      );
      expect(Option.isSome(yield* Fiber.poll(bot))).toBe(true);
    }),
  );

  it.effect("posts in the order told, one at a time, a slow post holding up the rest", () => {
    const delivered: Array<string> = [];
    const webhook = HttpClient.make((request) => {
      const body = request.body as unknown as { readonly body: Uint8Array };
      const { content } = JSON.parse(new TextDecoder().decode(body.body)) as { content: string };
      return Effect.sleep(content === "first" ? "1 second" : "0 seconds").pipe(
        Effect.zipRight(Effect.sync(() => delivered.push(content))),
        Effect.as(HttpClientResponse.fromWeb(request, new Response("ok"))),
      );
    });
    return Effect.gen(function* () {
      const alerts = yield* OpsAlerts;
      yield* alerts.post("first");
      yield* alerts.post("second");
      yield* TestClock.adjust("2 seconds");
      yield* Effect.repeatN(Effect.yieldNow(), 20);
      expect(delivered).toEqual(["first", "second"]);
    }).pipe(
      Effect.provide(OpsAlerts.DefaultWithoutDependencies),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, webhook)),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map([["OPS_WEBHOOK_URL", "https://example.invalid/hook"]])),
      ),
    );
  });
});
