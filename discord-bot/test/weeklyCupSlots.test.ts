// The Weekly Cup's messages on Discord (spec #353): how each slot's view is kept in the channel,
// over a fake channel that records every send, edit and drop.
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { DiscordError, UNKNOWN_MESSAGE } from "../src/discord/client.js";
import type { Payload } from "../src/discord/messages.js";
import type { CupMap, CupPostView, StandingsView } from "../src/weeklyCup/model.js";
import { cupStandings } from "../src/weeklyCup/points.js";
import { cupChannelOver, type SentPayload } from "../src/weeklyCup/slots.js";
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
/** The standings of `count` Entrants: 60 take more than one message, 3 take one. */
const standingsView = (count: number): StandingsView => {
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
    final: false,
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

describe("the Weekly Cup's slots", () => {
  it.effect("posts a one-time slot first with its nonce, and edits it only when it changes", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = cupChannelOver(fake.sink);
      const ids = yield* channel.show("post", [], postView([]));
      expect(ids).toEqual(["d1"]);
      expect(fake.sent[0]?.payload).toMatchObject({
        nonce: "cup-2026-10-26-post",
        enforceNonce: true,
      });
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
      yield* cupChannelOver(fake.sink).show("standings", [], standingsView(3));
      expect(fake.sent[0]?.payload.nonce).toBeUndefined();
    }),
  );

  it.effect("posts a deleted slot afresh, without the nonce, and hands back the new ids", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = cupChannelOver(fake.sink);
      const ids = yield* channel.show("post", [], postView([]));
      fake.deleted.add("d1");
      expect(yield* channel.show("post", ids, postView(["111"]))).toEqual(["d2"]);
      expect(fake.sent[1]?.payload.nonce).toBeUndefined();
    }),
  );

  it.effect("refuses, posting nothing, over a deleted message when asked not to repost", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = cupChannelOver(fake.sink);
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
      const channel = cupChannelOver(fake.sink);
      const one = yield* channel.show("standings", [], standingsView(3));
      expect(one).toHaveLength(1);
      const many = yield* channel.show("standings", one, standingsView(60));
      expect(many.length).toBeGreaterThan(1);
      expect(many[0]).toBe(one[0]);
      expect(fake.sent).toHaveLength(many.length);
      const back = yield* channel.show("standings", many, standingsView(3));
      expect(back).toEqual(one);
      expect(fake.dropped).toEqual(many.slice(1));
    }),
  );

  it.effect("puts a Shortlist's pictures up again in place of the old when it is edited", () =>
    Effect.gen(function* () {
      const fake = fakeSink();
      const channel = cupChannelOver(fake.sink);
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
      const channel = cupChannelOver(fake.sink);
      yield* channel.say({
        _tag: "CupMaps",
        week,
        entrants: ["1"],
        maps: [{ map: cupMap(1), votes: 1 }],
      });
      yield* channel.say({ _tag: "Skipped", week: week.week, entrants: ["1"] });
      expect(fake.sent.map((s) => s.payload.nonce)).toEqual(["cup-2026-10-26-cupmaps", undefined]);
    }),
  );
});
