// Which Venues the bot plays in: DISCORD_VENUES read beside the three home settings, and the
// rule that a Venue failing its startup checks is left out (and ops told), except home's, which
// stops the bot. The checks themselves are discord.js calls, tried in the sandbox; here only that
// one of them throwing is a failure of that Venue's check.
import { describe, expect, it } from "@effect/vitest";
import { ChannelType, type Client } from "discord.js";
import { Cause, Effect, Exit, Ref } from "effect";
import { checkVenue } from "../src/discord/client.js";
import {
  parseVenues,
  startVenues,
  VenueCheckFailed,
  type VenueConfig,
  type Venues,
} from "../src/venues.js";

const HOME = { guildId: "g-home", channelId: "c-home", pingRoleId: "r-home" };
const RACING = {
  name: "ballest-racing",
  guildId: "g-racing",
  channelId: "c-racing",
  pingRoleId: "r-racing",
};

describe("DISCORD_VENUES", () => {
  it("is home alone when absent or empty", () => {
    for (const setting of [undefined, "", "  ", "[]"])
      expect(parseVenues(HOME, setting)).toEqual({
        venues: [{ name: "home", ...HOME }],
        problems: [],
      });
  });

  it("adds each listed Venue after home", () => {
    const third = { name: "third", guildId: "g3", channelId: "c3", pingRoleId: "r3" };
    expect(parseVenues(HOME, JSON.stringify([RACING, third]))).toEqual({
      venues: [{ name: "home", ...HOME }, RACING, third],
      problems: [],
    });
  });

  it("leaves out every extra Venue, saying why, when it isn't a list of Venues", () => {
    for (const setting of ["not json", '{"name":"x"}', '[{"name":"x"}]']) {
      const { venues, problems } = parseVenues(HOME, setting);
      expect(venues).toEqual([{ name: "home", ...HOME }]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("DISCORD_VENUES");
    }
  });

  it("leaves out a Venue that takes another's name, server or channel, or names itself badly", () => {
    const { venues, problems } = parseVenues(
      HOME,
      JSON.stringify([
        RACING,
        { ...RACING, guildId: "g-other", channelId: "c-other" },
        { name: "home", guildId: "g4", channelId: "c4", pingRoleId: "r4" },
        { name: "copy", guildId: "g-home", channelId: "c5", pingRoleId: "r5" },
        { name: "copy2", guildId: "g6", channelId: "c-racing", pingRoleId: "r6" },
        { name: "Has Spaces", guildId: "g7", channelId: "c7", pingRoleId: "r7" },
      ]),
    );
    expect(venues.map((v) => v.name)).toEqual(["home", "ballest-racing"]);
    expect(problems).toHaveLength(5);
  });
});

describe("starting the Venues", () => {
  const check = (failing: ReadonlySet<string>) => (v: VenueConfig) =>
    failing.has(v.name)
      ? Effect.fail(new VenueCheckFailed({ reason: `no access to ${v.channelId}` }))
      : Effect.succeed(v.name);
  const venues: Venues<VenueConfig> = [{ name: "home", ...HOME }, RACING];

  it.effect("runs every Venue that passes its checks", () =>
    Effect.gen(function* () {
      const alerts = yield* Ref.make<ReadonlyArray<string>>([]);
      const running = yield* startVenues(venues, check(new Set()), (m) =>
        Ref.update(alerts, (all) => [...all, m]),
      );
      expect(running).toEqual(["home", "ballest-racing"]);
      expect(yield* Ref.get(alerts)).toEqual([]);
    }),
  );

  it.effect("leaves out another Venue that fails, telling ops, and runs on", () =>
    Effect.gen(function* () {
      const alerts = yield* Ref.make<ReadonlyArray<string>>([]);
      const running = yield* startVenues(venues, check(new Set(["ballest-racing"])), (m) =>
        Ref.update(alerts, (all) => [...all, m]),
      );
      expect(running).toEqual(["home"]);
      const said = yield* Ref.get(alerts);
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("ballest-racing");
      expect(said[0]).toContain("no access to c-racing");
    }),
  );

  it.effect("stops the bot when the home Venue fails", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        startVenues(venues, check(new Set(["home"])), () => Effect.void),
      );
      if (Exit.isSuccess(exit)) return expect.unreachable();
      expect(Cause.isDie(exit.cause)).toBe(true);
      expect(Cause.pretty(exit.cause)).toContain("no access to c-home");
    }),
  );
});

describe("checking a Venue", () => {
  it.effect("turns a discord.js call that throws into that Venue's check failing", () =>
    Effect.gen(function* () {
      // A text channel in the Venue's server whose permissions discord.js can't work out.
      const channel = {
        type: ChannelType.GuildText,
        id: RACING.channelId,
        guildId: RACING.guildId,
        name: "multiplayer",
        permissionsFor: () => {
          throw new Error("no cached member");
        },
      };
      const client = {
        user: { id: "bot" },
        channels: { fetch: () => Promise.resolve(channel) },
      } as unknown as Client<true>;
      const failed = yield* Effect.flip(checkVenue(client, RACING));
      expect(failed).toBeInstanceOf(VenueCheckFailed);
      expect(failed.reason).toContain("no cached member");
    }),
  );
});
