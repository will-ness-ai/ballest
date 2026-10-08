import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { headMessage, MESSAGE_LIMIT, pack, threadSections } from "../src/report/messages.js";
import {
  GhostDates,
  GhostUnavailable,
  oldestMapRecords,
  parseGhostStamp,
} from "../src/report/records.js";
import {
  buildReport,
  DAY_MS,
  type RecordCandidate,
  type Report,
  type ReportData,
  type ReportEntry,
  type ReportMap,
} from "../src/report/report.js";
import { ticks } from "./harness.js";

const AT = Date.UTC(2026, 9, 4, 16); // Sunday 4 October 2026, 16:00 UTC
const LONG_AGO = Date.UTC(2026, 8, 1);
const EARLIER = AT - 2 * DAY_MS;
const TODAY = AT - 3_600_000;

const map = (n: number, over: Partial<ReportMap> = {}): ReportMap => ({
  pfid: `pf${n}`,
  board: `Workshop_${n}`,
  title: `Map ${n}`,
  creator: "creator",
  createdAt: LONG_AGO,
  authorTicks: ticks(20),
  firstReadAt: LONG_AGO,
  ...over,
});
const entry = (
  m: ReportMap,
  steamId: string,
  seconds: number,
  over: Partial<ReportEntry> = {},
): ReportEntry => ({
  board: m.board,
  steamId,
  persona: steamId.toUpperCase(),
  score: ticks(seconds),
  ugcId: `ugc-${m.pfid}-${steamId}`,
  firstSeenAt: EARLIER,
  closedAt: null,
  ...over,
});
/** Since yesterday in the order it is posted: the Circuit, then the Workshop. */
const changes = (r: Report) => [...r.circuitChanges, ...r.workshopChanges];

const data = (over: Partial<ReportData>): ReportData => ({
  maps: [],
  entries: [],
  tracks: [],
  refreshedAt: null,
  ...over,
});

describe("the Daily Report's standings", () => {
  it("counts a creator on their own Map only when they beat the Author Medal by 1 ms", () => {
    const a = map(1);
    const r = buildReport(
      data({
        maps: [a],
        entries: [entry(a, "creator", 19.9995), entry(a, "ann", 25)],
      }),
      AT,
    );
    // 19.9995 s is 0.5 ms under Author: matching the publishing run, not beating it
    expect(r.players).toBe(1);
    expect(r.boards.find((b) => b.stat === "wr")?.rows).toEqual([
      { steamId: "ann", persona: "ANN", n: 1 },
    ]);
    const beat = buildReport(data({ maps: [a], entries: [entry(a, "creator", 19.99)] }), AT);
    expect(beat.boards.find((b) => b.stat === "author")?.rows[0]?.steamId).toBe("creator");
  });

  it("ranks by the stat, and breaks a tie by Steam ID", () => {
    const [a, b, c] = [map(1), map(2), map(3)];
    const r = buildReport(
      data({
        maps: [a, b, c],
        entries: [
          entry(a, "zed", 10),
          entry(b, "amy", 10),
          entry(c, "amy", 11),
          entry(c, "bob", 12),
          entry(a, "bob", 11),
        ],
      }),
      AT,
    );
    // amy holds two records and zed one; amy and bob tie on Maps played, and the ID decides
    expect(r.boards.find((b) => b.stat === "wr")?.rows.map((x) => x.steamId)).toEqual([
      "amy",
      "zed",
    ]);
    expect(r.boards.find((b) => b.stat === "played")?.rows.map((x) => x.steamId)).toEqual([
      "amy",
      "bob",
      "zed",
    ]);
  });

  it("lists unfinished and unclaimed Maps only once they are a day old", () => {
    const old = map(1, { title: "b old" });
    const fresh = map(2, { createdAt: TODAY });
    const tough = map(3, { title: "Tough", authorTicks: ticks(5) });
    const r = buildReport(
      data({
        maps: [old, fresh, tough],
        entries: [entry(tough, "ann", 9), entry(tough, "bob", 8)],
      }),
      AT,
    );
    expect(r.unfinished.map((m) => m.title)).toEqual(["b old"]);
    expect(r.unclaimed).toEqual([{ pfid: "pf3", title: "Tough", finishers: 2 }]);
    expect(r.newMaps).toBe(1);
  });
});

describe("since yesterday", () => {
  it("lists the Circuit first, then Workshop changes by the Map's players", () => {
    const quiet = map(1);
    const busy = map(2);
    const ann = entry(busy, "ann", 10, { closedAt: TODAY });
    const r = buildReport(
      data({
        maps: [quiet, busy],
        entries: [
          // quiet: a first finish
          entry(quiet, "cat", 30, { firstSeenAt: TODAY }),
          // busy: bob takes the record from ann, with two others on the board
          ann,
          entry(busy, "ann", 9.5, { firstSeenAt: TODAY }),
          entry(busy, "bob", 9, { firstSeenAt: TODAY }),
          entry(busy, "dee", 40),
        ],
        tracks: [
          {
            board: "Map_Track13",
            label: "S1 01",
            record: { steamId: "eve", persona: "Eve", score: ticks(10), ugcId: "u" },
            recordYesterday: { steamId: "fay", persona: "Fay", score: ticks(10.5), ugcId: "v" },
          },
        ],
      }),
      AT,
    );
    expect(changes(r).map((c) => c.kind)).toEqual(["trackRecord", "mapRecord", "firstFinish"]);
    expect(changes(r)[1]).toMatchObject({ by: "BOB", from: "ANN", players: 3 });
    expect(changes(r)[0]).toMatchObject({
      track: { board: "Map_Track13", label: "S1 01" },
      gain: ticks(0.5),
    });
  });

  it("doesn't list a holder improving their own record, or a Map published today", () => {
    const a = map(1);
    const fresh = map(2, { createdAt: TODAY });
    const r = buildReport(
      data({
        maps: [a, fresh],
        entries: [
          entry(a, "ann", 10, { closedAt: TODAY }),
          entry(a, "ann", 9, { firstSeenAt: TODAY }),
          entry(fresh, "bob", 30, { firstSeenAt: TODAY }),
        ],
      }),
      AT,
    );
    expect(changes(r)).toEqual([]);
  });

  it("lists nothing for a Map whose board was first read in the last day", () => {
    const a = map(1, { firstReadAt: TODAY });
    const r = buildReport(
      data({ maps: [a], entries: [entry(a, "ann", 10, { firstSeenAt: TODAY })] }),
      AT,
    );
    expect(changes(r)).toEqual([]);
  });

  it("notes the first Author Medal on a Map", () => {
    const a = map(1, { authorTicks: ticks(10) });
    const r = buildReport(
      data({
        maps: [a],
        entries: [entry(a, "ann", 12), entry(a, "bob", 9.9, { firstSeenAt: TODAY })],
      }),
      AT,
    );
    expect(changes(r).map((c) => [c.kind, "by" in c ? c.by : null])).toEqual([
      ["mapRecord", "BOB"],
      ["firstAuthor", "BOB"],
    ]);
  });
});

describe("the Daily Report's messages", () => {
  const busyDay = () => {
    const maps = Array.from({ length: 60 }, (_, i) =>
      map(i, { title: `A very long Map title number ${i} *with* markdown_` }),
    );
    const entries = maps.flatMap((m) => [
      entry(m, "old-holder-with-a-long-name", 10, { closedAt: TODAY }),
      entry(m, "new_holder @everyone", 9, { firstSeenAt: TODAY }),
    ]);
    return buildReport(data({ maps, entries }), AT);
  };

  it("heads the post with the day, and fits Since yesterday under Discord's limit", () => {
    const text = headMessage(busyDay());
    expect(text.startsWith("# Sunday 4 October\n-# Workshop standings · 60 Workshop Maps")).toBe(
      true,
    );
    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(text).toMatch(/…and \d+ more on smaller Workshop Maps/);
    expect(text).toContain("NEW\\_HOLDER @​EVERYONE");
    expect(text).toContain("A very long Map title number 0 \\*with\\* markdown\\_");
  });

  it("dates the data with a Discord timestamp", () => {
    const r = buildReport(data({ refreshedAt: Date.UTC(2026, 9, 4, 14) }), AT);
    expect(headMessage(r).split("\n")[1]).toBe(
      "-# Workshop standings · 0 Workshop Maps · 0 players · data as of <t:1791122400:R>",
    );
  });

  it("links Maps and Tracks to their pages on the site", () => {
    const a = map(1, { pfid: "3623648768" });
    const r = buildReport(
      data({
        maps: [a],
        entries: [entry(a, "ann", 30, { firstSeenAt: TODAY })],
        tracks: [
          {
            board: "Map_Track13",
            label: "S1 01",
            record: { steamId: "eve", persona: "Eve", score: ticks(10), ugcId: "u" },
            recordYesterday: { steamId: "fay", persona: "Fay", score: ticks(10.5), ugcId: "v" },
          },
        ],
      }),
      AT,
    );
    const text = headMessage(r);
    expect(text).toContain("took [S1 01](<https://ballestrecords.com/board/Map_Track13>) from");
    expect(text).toContain("[Map 1](<https://ballestrecords.com/map/3623648768>)");
    expect(text).not.toContain("steamcommunity");
    const thread = threadSections(r, {
      tracks: [
        {
          steamId: "eve",
          persona: "Eve",
          score: ticks(10),
          ugcId: "u",
          where: { track: { board: "Map_Track13", label: "S1 01" } },
          publishedAt: null,
          setAt: LONG_AGO,
        },
      ],
      maps: [],
    }).join("\n");
    expect(thread).toContain("[S1 01](<https://ballestrecords.com/board/Map_Track13>) in");
  });

  it("says when nothing changed", () => {
    expect(headMessage(buildReport(data({}), AT))).toContain("- Nothing changed.");
  });

  it("splits the thread into messages under the limit, a long list between lines", () => {
    const maps = Array.from({ length: 200 }, (_, i) => map(i, { title: `Unplayed ${i}` }));
    const messages = pack(
      threadSections(buildReport(data({ maps }), AT), { tracks: [], maps: [] }),
    );
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(messages.join("\n")).toContain("Unplayed 199");
  });
});

describe("the longest-standing records", () => {
  it("parses a ghost's stamp, and treats an unset one as no date", () => {
    expect(parseGhostStamp("2025.10.27-17.25.22")).toEqual(
      Option.some(Date.UTC(2025, 9, 27, 17, 25, 22)),
    );
    expect(parseGhostStamp("0001.01.01-00.00.00")).toEqual(Option.none());
    expect(parseGhostStamp("garbage")).toEqual(Option.none());
  });

  const candidate = (n: number, publishedAt: number, ugcId = `u${n}`): RecordCandidate => ({
    steamId: `s${n}`,
    persona: `P${n}`,
    score: ticks(10),
    ugcId,
    where: { map: { pfid: `pf${n}`, title: `Map ${n}`, finishers: 1 } },
    publishedAt,
  });

  it.effect("walks oldest Map first, skips undatable records, and stops early", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const dates: Record<string, number> = {
        u1: Date.UTC(2025, 9, 27),
        u3: Date.UTC(2025, 9, 29),
        u4: Date.UTC(2025, 9, 28),
      };
      const ghosts = Layer.succeed(
        GhostDates,
        GhostDates.of({
          setAt: (ugcId) => {
            asked.push(ugcId);
            return ugcId === "u2"
              ? Effect.fail(new GhostUnavailable({ reason: "gone" }))
              : Effect.succeed(Option.fromNullable(dates[ugcId]));
          },
        }),
      );
      const day = (d: number) => Date.UTC(2025, 9, d);
      const oldest = yield* oldestMapRecords([
        candidate(5, day(29) + 30 * DAY_MS), // published long after the third record: never asked
        candidate(3, day(28)),
        candidate(1, day(26)),
        candidate(2, day(27)),
        candidate(4, day(28)),
      ]).pipe(Effect.provide(ghosts));
      expect(oldest.map((r) => r.steamId)).toEqual(["s1", "s4", "s3"]);
      expect(asked).toEqual(["u1", "u2", "u3", "u4"]);
    }),
  );
});
