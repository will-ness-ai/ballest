// The Weekly Cup's messages on Discord (spec #353): how each slot's view is kept in the channel,
// over a fake channel that records every send, edit and drop.
import { describe, expect, it } from "@effect/vitest";
import type { AttachmentBuilder } from "discord.js";
import { Effect } from "effect";
import { DiscordError, UNKNOWN_MESSAGE } from "../src/discord/client.js";
import type { Payload } from "../src/discord/messages.js";
import { formatTime } from "../src/domain.js";
import { RenderError } from "../src/render/renderer.js";
import type { CupStandingsImage } from "../src/render/scenes.js";
import type { CupMap, CupPostView, StandingsView } from "../src/weeklyCup/model.js";
import { cupStandings } from "../src/weeklyCup/points.js";
import {
  type CupPictures,
  cupChannelOver,
  type SentPayload,
  sentOnce,
} from "../src/weeklyCup/slots.js";
import { weekAt } from "../src/weeklyCup/week.js";
import { ticks } from "./harness.js";

const week = weekAt(Date.parse("2026-10-27T15:00:00Z"));
const postView = (entrants: ReadonlyArray<string>): CupPostView => ({
  guildId: "g-racing",
  week,
  state: "open",
  entrants,
});
const cupMap = (n: number): CupMap => ({
  pfid: `pf${n}`,
  title: `Map ${n}`,
  creator: "pebblewright",
  previewUrl: `https://example.invalid/${n}.jpg`,
  authorSeconds: 20.5,
  boardId: 100 + n,
  worldRecordTicks: ticks(15),
});
/** The standings of `count` Entrants: 100 take more than one message of results, 3 take one. */
const standingsView = (count: number, final = false): StandingsView => {
  const entrants = Array.from({ length: count }, (_, i) =>
    String(100_000_000_000_000_000n + BigInt(i)),
  );
  const maps = [cupMap(1), cupMap(2), cupMap(3)];
  const times = Object.fromEntries(
    maps.map((m) => [m.pfid, Object.fromEntries(entrants.map((id, i) => [id, ticks(20 + i)]))]),
  );
  return {
    guildId: "g-racing",
    week,
    maps,
    final,
    lateReads: [],
    standings: cupStandings(maps, entrants, times),
  };
};

/** A channel that keeps what it was sent; a message in `deleted` is gone. */
const fakeSink = () => {
  const sent: Array<{ id: string; payload: SentPayload }> = [];
  const edited: Array<{ id: string; payload: Payload & { attachments?: unknown } }> = [];
  const dropped: Array<string> = [];
  const deleted = new Set<string>();
  const unknown = (id: string) =>
    new DiscordError({ op: "update", cause: { code: UNKNOWN_MESSAGE, message: `${id} is gone` } });
  const sink = {
    send: (payload: SentPayload) =>
      Effect.sync(() => {
        const id = `d${sent.length + 1}`;
        sent.push({ id, payload });
        return id;
      }),
    edit: (id: string, payload: Payload) =>
      deleted.has(id)
        ? Effect.fail(unknown(id))
        : Effect.sync(() => void edited.push({ id, payload })),
    drop: (id: string) =>
      deleted.has(id) ? Effect.fail(unknown(id)) : Effect.sync(() => void dropped.push(id)),
  };
  return { sink, sent, edited, dropped, deleted };
};

/** Pictures drawn as the JSON of what they show, each draw kept; `failing` refuses to draw. */
const fakePictures = (failing = false) => {
  const drawn: Array<CupStandingsImage> = [];
  const pictures: CupPictures = {
    nameOf: (discordId) => Effect.succeed(`name-${discordId}`),
    standings: (image) =>
      failing
        ? Effect.fail(new RenderError({ cause: "no fonts" }))
        : Effect.sync(() => {
            drawn.push(image);
            return new TextEncoder().encode(JSON.stringify(image));
          }),
  };
  return { pictures, drawn };
};
const over = (sink: ReturnType<typeof fakeSink>["sink"], guildId = "g-racing") =>
  cupChannelOver(sink, guildId, fakePictures().pictures);

/** Everything a payload shows: its text and components, each file's alt text and contents. */
const everythingIn = (p: Payload) => {
  const { files = [], ...rest } = p;
  return [
    JSON.stringify(rest),
    ...files.map((f) => {
      const a = f as AttachmentBuilder;
      return `${a.description ?? ""} ${Buffer.from(a.attachment as Buffer).toString("utf8")}`;
    }),
  ].join("\n");
};

describe("the Weekly Cup's slots", () => {
  it.effect("posts a one-time slot first with its nonce, and edits it only when it changes", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      const ids = yield* channel.show("post", [], postView([]));
      expect(ids).toEqual(["d1"]);
      expect(fake.sent[0]?.payload).toMatchObject({ enforceNonce: true });
      const nonce = fake.sent[0]?.payload.nonce;
      expect(nonce).toBeDefined();
      // Another server's post of the same week goes with a nonce of its own.
      const other = fakeSink();
      yield* over(other.sink, "g-other").show("post", [], postView([]));
      expect(other.sent[0]?.payload.nonce).not.toBe(nonce);
      expect(yield* channel.show("post", ids, postView([]))).toEqual(ids);
      expect(fake.edited).toEqual([]);
      expect(yield* channel.show("post", ids, postView(["111"]))).toEqual(ids);
      expect(fake.edited.map((e) => e.id)).toEqual(["d1"]);
      expect(fake.sent).toHaveLength(1);
    }),
  );

  it.effect("posts the standings without a nonce, as they are redrawn every read", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      yield* over(fake.sink).show("standings", [], standingsView(3));
      expect(fake.sent[0]?.payload.nonce).toBeUndefined();
    }),
  );

  it.effect("posts a deleted slot afresh, without the nonce, and hands back the new ids", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      const ids = yield* channel.show("post", [], postView([]));
      fake.deleted.add("d1");
      expect(yield* channel.show("post", ids, postView(["111"]))).toEqual(["d2"]);
      expect(fake.sent[1]?.payload.nonce).toBeUndefined();
    }),
  );

  it.effect("refuses, posting nothing, over a deleted message when asked not to repost", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      const ids = yield* channel.show("post", [], postView([]));
      fake.deleted.add("d1");
      const shown = yield* Effect.either(
        channel.show("post", ids, postView(["111"]), { repost: false }),
      );
      expect(shown._tag).toBe("Left");
      expect(fake.sent).toHaveLength(1);
    }),
  );

  it.effect("posts or drops the messages a view now takes more or fewer of", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      const one = yield* channel.show("results", [], standingsView(3, true));
      expect(one).toHaveLength(1);
      const many = yield* channel.show("results", one, standingsView(100, true));
      expect(many.length).toBeGreaterThan(1);
      expect(many[0]).toBe(one[0]);
      expect(fake.sent).toHaveLength(many.length);
      const back = yield* channel.show("results", many, standingsView(3, true));
      expect(back).toEqual(one);
      expect(fake.dropped).toEqual(many.slice(1));
    }),
  );

  it.effect("shows the standings as their picture, named, drawn again only when it changes", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const pictures = fakePictures();
      const channel = cupChannelOver(fake.sink, "g-racing", pictures.pictures);
      const ids = yield* channel.show("standings", [], standingsView(3));
      expect(pictures.drawn.map((i) => i.rows.map((r) => r.name))).toEqual([
        ["name-100000000000000000", "name-100000000000000001", "name-100000000000000002"],
      ]);
      expect(fake.sent[0]?.payload.files).toHaveLength(1);
      expect(yield* channel.show("standings", ids, standingsView(3))).toEqual(ids);
      expect(pictures.drawn).toHaveLength(1);
      expect(fake.edited).toEqual([]);
      yield* channel.show("standings", ids, standingsView(4));
      expect(pictures.drawn).toHaveLength(2);
      expect(fake.edited.map((e) => e.id)).toEqual(ids);
      expect(fake.edited[0]?.payload.attachments).toEqual([]);
    }),
  );

  it.effect("refuses to show the standings when their picture can't be drawn", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = cupChannelOver(fake.sink, "g-racing", fakePictures(true).pictures);
      const shown = yield* Effect.either(channel.show("standings", [], standingsView(3)));
      expect(shown._tag === "Left" && shown.left._tag).toBe("CupPostFailed");
      expect(fake.sent).toEqual([]);
    }),
  );

  it.effect("shows no Entrant's time anywhere in the Cup's channel before the results", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      const entrants = ["111", "222"];
      const maps = [cupMap(1), cupMap(2), cupMap(3)];
      // Times unlike any Map's author time (20.5) or anything else the posts show.
      const seconds = [12.345, 47.891, 61.234, 33.333];
      const times = {
        pf1: { "111": ticks(seconds[0] ?? 0), "222": ticks(seconds[1] ?? 0) },
        pf2: { "111": ticks(seconds[2] ?? 0) },
        pf3: { "222": ticks(seconds[3] ?? 0) },
      };
      const live: StandingsView = {
        guildId: "g-racing",
        week,
        maps,
        final: false,
        lateReads: [],
        standings: cupStandings(maps, entrants, times),
      };
      let post: ReadonlyArray<string> = [];
      for (const state of ["open", "voting", "racing", "final"] as const)
        post = yield* channel.show("post", post, { ...postView(entrants), state });
      yield* channel.show("shortlist", [], {
        guildId: "g-racing",
        week,
        wanted: 10,
        closed: false,
        maps: maps.map((map) => ({ map, picture: null })),
      });
      yield* channel.say({
        _tag: "CupMaps",
        week,
        entrants,
        maps: maps.map((map) => ({ map, votes: 1 })),
      });
      const standings = yield* channel.show("standings", [], live);
      yield* channel.show("standings", standings, { ...live, final: true });
      const everything = [...fake.sent, ...fake.edited].map((s) => everythingIn(s.payload));
      // The post and its three redraws, the Shortlist, the Cup Maps, the standings and their close.
      expect(everything).toHaveLength(8);
      const written = seconds.flatMap((s) => {
        const t = formatTime(ticks(s));
        return [t, t.replace(/^0:/, ""), String(s), String(ticks(s))];
      });
      for (const text of everything) for (const t of written) expect(text).not.toContain(t);
      // The results do show them.
      const results = fakeSink();
      yield* over(results.sink).show("results", [], { ...live, final: true });
      expect(everythingIn(results.sent[0]?.payload ?? {})).toContain("12.345");
    }),
  );

  it.effect("puts a Shortlist's pictures up again in place of the old when it is edited", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      const shortlist = (closed: boolean) => ({
        guildId: "g-racing",
        week,
        wanted: 10,
        closed,
        maps: [1, 2, 3].map((n) => ({
          map: cupMap(n),
          picture: { type: "image/jpeg", body: new Uint8Array([n]) },
        })),
      });
      const ids = yield* channel.show("shortlist", [], shortlist(false));
      yield* channel.show("shortlist", ids, shortlist(true));
      expect(fake.edited[0]?.payload.attachments).toEqual([]);
    }),
  );

  it.effect("tells the Cup Maps once, with a nonce, and other notices plainly", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = over(fake.sink);
      yield* channel.say({
        _tag: "CupMaps",
        week,
        entrants: ["1"],
        maps: [{ map: cupMap(1), votes: 1 }],
      });
      yield* channel.say({ _tag: "Skipped", week: week.week, entrants: ["1"] });
      expect(fake.sent.map((s) => s.payload.nonce)).toEqual([
        sentOnce({}, "g-racing", "2026-10-26", "cupmaps").nonce,
        undefined,
      ]);
    }),
  );
});
