// #weekly-cup (spec #353) over a fake server behind the SetupGuild port: kept by id, else reused
// by name with the Match channel's overwrites, else made with them, asking only for the
// permission what it does needs.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Option } from "effect";
import {
  type ChannelAccess,
  MATCH_CHANNEL_ACCESS,
  type ServerPermission,
  type SetupGuild,
  VenueSetupFailed,
} from "../src/venues.js";
import { keepCupChannel } from "../src/weeklyCup/channel.js";

const fakeGuild = (
  channels: Array<{ id: string; name: string; access?: ChannelAccess }>,
  missing: ReadonlyArray<ServerPermission> = [],
) => {
  const made: Array<string> = [];
  const port: SetupGuild = {
    id: "g-racing",
    name: "Ballest Racing",
    joinedAt: null,
    holds: () => false,
    bot: Effect.succeed({ missing, topRolePosition: 10 }),
    textChannels: Effect.sync(() => channels.map(({ id, name }) => ({ id, name }))),
    createTextChannel: (name, access) =>
      Effect.sync(() => {
        const id = `c-new${channels.length}`;
        channels.push({ id, name, access });
        made.push(name);
        return id;
      }),
    setAccess: (channelId, access) =>
      Effect.suspend(() => {
        const c = channels.find((x) => x.id === channelId);
        if (c === undefined) return Effect.fail(new VenueSetupFailed({ reason: "gone" }));
        c.access = access;
        return Effect.void;
      }),
    roles: Effect.succeed([]),
    createRole: () => Effect.dieMessage("the Cup makes no role"),
  };
  return { port, channels, made };
};

describe("#weekly-cup", () => {
  it.effect("is made with the Match channel's overwrites when the server has none", () =>
    Effect.gen(function* () {
      const g = fakeGuild([{ id: "c-general", name: "general" }]);
      const id = yield* keepCupChannel(g.port, Option.none());
      expect(g.made).toEqual(["weekly-cup"]);
      expect(g.channels.find((c) => c.id === id)?.access).toEqual(MATCH_CHANNEL_ACCESS);
    }),
  );

  it.effect("reuses one already there by name, setting its overwrites", () =>
    Effect.gen(function* () {
      const g = fakeGuild([{ id: "c-cup", name: "weekly-cup" }]);
      expect(yield* keepCupChannel(g.port, Option.none())).toBe("c-cup");
      expect(g.made).toEqual([]);
      expect(g.channels[0]?.access).toEqual(MATCH_CHANNEL_ACCESS);
    }),
  );

  it.effect("keeps the stored one by id, renamed or not, touching nothing", () =>
    Effect.gen(function* () {
      const g = fakeGuild([{ id: "c-cup", name: "cup-of-the-week" }], ["Manage Channels"]);
      expect(yield* keepCupChannel(g.port, Option.some("c-cup"))).toBe("c-cup");
      expect(g.made).toEqual([]);
      expect(g.channels[0]?.access).toBeUndefined();
    }),
  );

  it.effect("makes it again when the stored one was deleted", () =>
    Effect.gen(function* () {
      const g = fakeGuild([]);
      yield* keepCupChannel(g.port, Option.some("c-gone"));
      expect(g.made).toEqual(["weekly-cup"]);
    }),
  );

  it.effect("says which permission it lacks, and makes nothing", () =>
    Effect.gen(function* () {
      const none = fakeGuild([], ["Manage Channels"]);
      const made = yield* Effect.either(keepCupChannel(none.port, Option.none()));
      expect(Either.getLeft(made).pipe(Option.map((e) => e.reason))).toEqual(
        Option.some("the bot needs Manage Channels there to make #weekly-cup"),
      );
      expect(none.made).toEqual([]);
      const there = fakeGuild([{ id: "c-cup", name: "weekly-cup" }], ["Manage Roles"]);
      const reused = yield* Effect.either(keepCupChannel(there.port, Option.none()));
      expect(Either.getLeft(reused).pipe(Option.map((e) => e.reason))).toEqual(
        Option.some("the bot needs Manage Roles there to set #weekly-cup's permissions"),
      );
    }),
  );
});
