// The Traffic Report: what it says (src/traffic/report.ts), how the two APIs' answers become it
// (plausible.ts, searchConsole.ts), the service account's signed token request, and the schedule
// (traffic/daily.ts) over fakes on the TestClock.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, TestClock } from "effect";
import { OpsAlerts } from "../src/ops.js";
import {
  TrafficChannel,
  TrafficLog,
  TrafficPostFailed,
  trafficLoop,
} from "../src/traffic/daily.js";
import { daysBefore } from "../src/everyDay.js";
import { rankedBy, VisitsSource } from "../src/traffic/plausible.js";
import {
  change,
  compared,
  TrafficUnavailable,
  trafficMessage,
  type Visits,
} from "../src/traffic/report.js";
import { assertion, searchFrom } from "../src/traffic/searchConsole.js";

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
const DAY0 = Date.UTC(2026, 9, 18); // midnight UTC, Sunday 18 October

const VISITS: Visits = {
  date: "2026-10-17",
  visitors: { day: 412, weekMean: 368 },
  pageviews: { day: 1903, weekMean: 2000 },
  visitDuration: 130,
  bounceRate: 41.4,
  pages: [
    { name: "/daily", n: 120 },
    { name: "/", n: 98 },
  ],
  sources: [
    { name: "Direct / None", n: 200 },
    { name: "Google", n: 40 },
  ],
};

const row = (key: string, clicks: number, impressions: number, position = 10) => ({
  keys: [key],
  clicks,
  impressions,
  position,
});

describe("what the Traffic Report says", () => {
  it("compares a day with the week's mean", () => {
    expect(change({ day: 412, weekMean: 368 })).toBe(" (+12% on the week's 368 a day)");
    expect(change({ day: 0, weekMean: 4 })).toBe(" (-100% on the week's 4 a day)");
    expect(change({ day: 3, weekMean: 0 })).toBe(" (new this week)");
    expect(change({ day: 3, weekMean: null })).toBe("");
  });

  it("lays out the visits, with links that don't unfurl", () => {
    const text = trafficMessage({ _tag: "Ok", value: VISITS }, { _tag: "Off" });
    expect(text).toContain("## Visits · Saturday 17 October");
    expect(text).toContain("**412** visitors (+12% on the week's 368 a day)");
    expect(text).toContain("Visits last 2m 10s on average; 41% leave after one page.");
    expect(text).toContain("[/daily](<https://ballestrecords.com/daily>) 120");
    expect(text).toContain("**Sources** Direct / None 200 · Google 40");
    expect(text).toContain("_Google search: not set up._");
  });

  it("says when a half couldn't be read", () => {
    const text = trafficMessage(
      { _tag: "Failed", reason: "Plausible timeseries: ResponseError" },
      { _tag: "Off" },
    );
    expect(text.split("\n")[0]).toBe(
      "_Visits: couldn't be read (Plausible timeseries: ResponseError)._",
    );
  });

  it("fits in one Discord message", () => {
    const long: Visits = {
      ...VISITS,
      pages: Array.from({ length: 5 }, (_, i) => ({
        name: "/" + "x".repeat(300) + String(i),
        n: i,
      })),
    };
    expect(trafficMessage({ _tag: "Ok", value: long }, { _tag: "Off" }).length).toBeLessThanOrEqual(
      2000,
    );
  });
});

describe("reading the APIs' answers", () => {
  it("compares with the week before, a day the series lacks counting as 0", () => {
    const days = [
      { date: "2026-10-15", n: 2 },
      { date: "2026-10-16", n: 4 },
      { date: "2026-10-17", n: 9 },
    ];
    expect(compared(days, "2026-10-17")).toEqual({ day: 9, weekMean: 6 / 7 });
    expect(compared([...days, { date: "2026-10-09", n: 70 }], "2026-10-17").weekMean).toBe(6 / 7);
    expect(compared([], "2026-10-17")).toEqual({ day: 0, weekMean: null });
  });

  it("names a breakdown's rows by its property", () => {
    expect(
      rankedBy("page", [
        { page: "/", visitors: 3 },
        { page: 5, visitors: 1 },
      ]),
    ).toEqual([{ name: "/", n: 3 }]);
  });

  it("takes Search Console's newest day, and finds searches new to it", () => {
    const s = searchFrom({
      days: [row("2026-10-14", 1, 10), row("2026-10-15", 3, 30), row("2026-10-16", 5, 50, 12.5)],
      queries: [row("ballest leaderboard", 3, 20), row("ballest records", 2, 30)],
      pages: [row("https://ballestrecords.com/", 4, 40)],
      seen: [row("ballest leaderboard", 1, 5)],
      sitemaps: {
        sitemap: [
          {
            path: "https://ballestrecords.com/sitemap.xml",
            lastDownloaded: "2026-10-16T08:00:00Z",
            errors: 0,
            warnings: 0,
          },
        ],
      },
    })!;
    expect(s.date).toBe("2026-10-16");
    expect(s.clicks).toEqual({ day: 5, weekMean: 4 / 7 });
    expect(s.position).toBe(12.5);
    expect(s.newQueries).toEqual(["ballest records"]);
    const text = trafficMessage({ _tag: "Off" }, { _tag: "Ok", value: s });
    expect(text).toContain("## Google search · Friday 16 October");
    expect(text).toContain(
      "**5** clicks (+775% on the week's 1 a day) from **50** times in results",
    );
    expect(text).toContain('**New searches** "ballest records"');
    expect(text).toContain("[/](<https://ballestrecords.com/>) 4 clicks, 40 seen, #10.0");
    expect(text).toContain("**Sitemap** /sitemap.xml: read Friday 16 October, no errors");
  });

  it("has no day when nothing showed the site", () => {
    expect(
      searchFrom({ days: [], queries: [], pages: [], seen: [], sitemaps: { sitemap: [] } }),
    ).toBeNull();
  });

  it("signs the service account's token request with its key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = assertion(
      {
        client_email: "report@ballest.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        token_uri: "https://oauth2.googleapis.com/token",
      },
      DAY0,
    );
    const [head = "", claims = "", signature = ""] = jwt.split(".");
    const ok = createVerify("RSA-SHA256")
      .update(`${head}.${claims}`)
      .verify(publicKey, signature, "base64url");
    expect(ok).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "report@ballest.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: DAY0 / 1000 + 3600,
    });
  });

  it("counts days back across a month", () => {
    expect(daysBefore("2026-10-01", 1)).toBe("2026-09-30");
  });
});

/** The schedule over fakes: a channel that records each post's first line (or fails while
 * `failing`), Plausible that records the dates it was asked for (or is down while `down`), no
 * Search Console, and the ops channel's messages. */
const setup = Effect.gen(function* () {
  const posts = yield* Ref.make<Array<string>>([]);
  const days = new Set<string>();
  const alerts = yield* Ref.make<Array<string>>([]);
  const failing = yield* Ref.make(false);
  const down = yield* Ref.make(false);
  const asked = yield* Ref.make<Array<string>>([]);
  const fakes = Layer.mergeAll(
    Layer.succeed(
      TrafficChannel,
      TrafficChannel.of({
        post: (content) =>
          Effect.gen(function* () {
            if (yield* Ref.get(failing))
              return yield* new TrafficPostFailed({ reason: "ResponseError" });
            yield* Ref.update(posts, (p) => [...p, content.split("\n")[0] ?? ""]);
          }),
      }),
    ),
    Layer.succeed(
      TrafficLog,
      TrafficLog.of({
        posted: (day) => Effect.sync(() => days.has(day)),
        record: (day) => Effect.sync(() => void days.add(day)),
      }),
    ),
    Layer.succeed(
      VisitsSource,
      VisitsSource.of({
        read: (date) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (a) => [...a, date]);
            if (yield* Ref.get(down))
              return yield* new TrafficUnavailable({
                reason: "Plausible timeseries: RequestError",
              });
            return { ...VISITS, date };
          }),
      }),
    ),
    Layer.succeed(
      OpsAlerts,
      OpsAlerts.make({
        configured: true,
        post: (content) => Ref.update(alerts, (a) => [...a, content]),
      }),
    ),
  );
  return { posts, alerts, failing, down, asked, fakes };
});

const runFor = (ms: number) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(trafficLoop);
    yield* TestClock.adjust(ms);
    yield* Fiber.interrupt(fiber);
  });

describe("the Traffic Report's schedule", () => {
  it.scoped("posts yesterday's visits at 13:00 UTC every day", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 10 * HOUR);
        yield* runFor(2 * HOUR);
        expect(yield* Ref.get(t.posts)).toEqual([]);
        yield* runFor(2 * HOUR + DAY_MS);
        expect(yield* Ref.get(t.posts)).toEqual([
          "## Visits · Saturday 17 October",
          "## Visits · Sunday 18 October",
        ]);
        expect(yield* Ref.get(t.asked)).toEqual(["2026-10-17", "2026-10-18"]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );

  it.scoped("catches up once after a late start, and never posts a day twice", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 18 * HOUR);
        yield* runFor(HOUR);
        yield* runFor(HOUR); // a restart the same evening
        expect(yield* Ref.get(t.posts)).toEqual(["## Visits · Saturday 17 October"]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );

  it.scoped("still posts when a half can't be read, saying so there and in ops", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.down, true);
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 18 * HOUR);
        yield* runFor(HOUR);
        expect(yield* Ref.get(t.posts)).toEqual([
          "_Visits: couldn't be read (Plausible timeseries: RequestError)._",
        ]);
        expect(yield* Ref.get(t.alerts)).toEqual([
          "The Traffic Report for 2026-10-18 couldn't read Visits: Plausible timeseries: RequestError",
        ]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );

  it.scoped("tells ops when the post fails, and tries again on the next start", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* Ref.set(t.failing, true);
      yield* Effect.gen(function* () {
        yield* TestClock.setTime(DAY0 + 18 * HOUR);
        yield* runFor(HOUR);
        expect(yield* Ref.get(t.alerts)).toEqual([
          "Multiballs couldn't post the Traffic Report for 2026-10-18: ResponseError",
        ]);
        yield* Ref.set(t.failing, false);
        yield* runFor(HOUR);
        expect(yield* Ref.get(t.posts)).toEqual(["## Visits · Saturday 17 October"]);
      }).pipe(Effect.provide(t.fakes));
    }),
  );
});
