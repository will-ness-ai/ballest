// The sandbox driver (scripts/sandbox/driver.ts) through InteractionsLive: its stand-in
// Interaction runs a click exactly as Discord's would, so a Player's whole path from New Match to
// a live Match can be pressed, and what the bot answered privately comes back in Discord's shape.
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { Effect, Layer, Option, Stream } from "effect";
import type { Interaction } from "discord.js";
import { Discord, type DiscordVenue, type VenueInteraction } from "../src/discord/client.js";
import { DriverInteractions, InteractionsLive } from "../src/discord/interactions.js";
import { Engine } from "../src/engine.js";
import { Pings } from "../src/pings.js";
import { controlId } from "../src/discord/controls.js";
import { PROFILE_FIELD } from "../src/discord/messages.js";
import {
  ChosenSkins,
  type ChosenSkin,
  MatchLinks,
  type ProfilePreview,
  Store,
} from "../src/ports.js";
import { Renderer } from "../src/render/renderer.js";
import { OpsAlerts, opsAlertsOf } from "../src/ops.js";
import { makeSeeMyStats, SeeMyStats, StatsLinks, StatsSite } from "../src/seeMyStats.js";
import type { SkipAsk } from "../src/weeklyCup/model.js";
import { WeeklyCups } from "../src/weeklyCup/schedule.js";
import { controlsOf, fromPayload } from "../scripts/discord/describe.js";
import { fakeInteraction, type Press } from "../scripts/sandbox/driver.js";
import { ALICE, BOB, type Harness, makeHarness, makeMap } from "./harness.js";

const SITE = "https://ballestrecords.test";

/** See my stats over a database where only Alice is paired, and a site that draws every card. */
const seeMyStats = Layer.scoped(SeeMyStats, makeSeeMyStats).pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(
        StatsLinks,
        StatsLinks.of({
          pairedWith: (id) =>
            Effect.succeed(id === ALICE.discordId ? Option.some(ALICE.steamId) : Option.none()),
          request: () => Effect.succeed("token1"),
          used: () => Effect.succeed(false),
        }),
      ),
      Layer.succeed(
        StatsSite,
        StatsSite.of({ url: SITE, card: () => Effect.succeed(Buffer.from("png")) }),
      ),
      Layer.succeed(
        OpsAlerts,
        OpsAlerts.make(opsAlertsOf({ configured: false, post: () => Effect.void })),
      ),
    ),
  ),
);

/**
 * InteractionsLive over the harness's engine, fed by the driver: `press` clicks or submits as a
 * member and reads back every private answer in Discord's message shape.
 */
const driven = (
  h: Harness,
  renderer: Layer.Layer<Renderer> = Renderer.Default,
  cups: WeeklyCups["Type"] = WeeklyCups.of({ in: () => Effect.succeed(Option.none()) }),
) =>
  Effect.gen(function* () {
    const queue: Array<(i: unknown) => void> = [];
    // The driver's clicks play in the home Venue, as in the sandbox.
    const home = {
      name: "home",
      pingRoleId: "r-ping",
      pingRoleName: "Multiplayer ping",
    } as unknown as DiscordVenue;
    const feed = Stream.async<VenueInteraction>(
      (emit) =>
        void queue.push((i) => void emit.single({ interaction: i as Interaction, venue: home })),
    );
    const discord = Layer.succeed(
      Discord,
      Discord.make({ interactions: Stream.empty, home } as never),
    );
    yield* Layer.build(
      InteractionsLive.pipe(
        Layer.provide(Layer.succeed(DriverInteractions, feed)),
        Layer.provide(
          Layer.mergeAll(
            discord,
            Layer.succeed(Engine, h.engine),
            Layer.succeed(Store, h.store),
            Layer.succeed(Pings, h.pings),
            Layer.succeed(ChosenSkins, h.chosenSkins.port),
            Layer.succeed(MatchLinks, MatchLinks.of({ of: () => Effect.succeed(Option.none()) })),
            renderer,
            seeMyStats,
            Layer.succeed(WeeklyCups, cups),
          ),
        ),
      ),
    );
    yield* Effect.sleep("50 millis");
    return (p: Press) =>
      Effect.promise(async () => {
        const { interaction, settled } = fakeInteraction(p, "c1");
        for (const push of queue) push(interaction);
        return (await settled).map((c) => ({
          method: c.method,
          message: c.payload === undefined ? null : fromPayload(c.method, c.payload),
        }));
      });
  });

describe("the driver's stand-in interaction", () => {
  it.effect("waits for the answer a defer promises, which can take seconds", () =>
    Effect.promise(async () => {
      vi.useFakeTimers();
      try {
        const { interaction, settled } = fakeInteraction(
          { kind: "button", customId: "mb:lobby", as: ALICE.discordId },
          "c1",
        );
        const i = interaction as unknown as {
          deferUpdate: () => Promise<void>;
          editReply: (p: unknown) => Promise<void>;
        };
        // What the driver hands back is what had been called when it settled.
        const answered = settled.then((calls) => calls.map((c) => c.method));
        void i.deferUpdate();
        // Opening a Lobby answers about 4 s after its defer.
        await vi.advanceTimersByTimeAsync(4000);
        void i.editReply({ content: "Lobby" });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await answered).toEqual(["deferUpdate", "editReply"]);
      } finally {
        vi.useRealTimers();
      }
    }),
  );
});

describe("the sandbox driver", () => {
  it.live(
    "presses a Player from New Match to a live Match",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const press = yield* driven(h);
        const button = (answers: ReadonlyArray<{ message: unknown }>, label: string) =>
          answers
            .flatMap((a) =>
              a.message === null ? [] : controlsOf((a.message as { components?: [] }).components),
            )
            .find((c) => c.label === label)?.target ?? "";

        const menu = yield* press({ kind: "button", customId: "mb:new", as: ALICE.discordId });
        expect(menu.map((a) => a.method)).toEqual(["reply"]);
        const types = yield* press({
          kind: "button",
          customId: button(menu, "Public 1v1"),
          as: ALICE.discordId,
        });
        const chosen = yield* press({
          kind: "button",
          customId: button(types, "10m"),
          as: ALICE.discordId,
        });
        const opened = yield* press({
          kind: "button",
          customId: button(chosen, "Open Invite"),
          as: ALICE.discordId,
        });
        expect(opened.at(-1)?.message).toMatchObject({
          content: "Invite opened. It's in the channel now.",
        });

        const invite = (yield* h.store.activeMatches)[0];
        expect(invite?.state).toBe("invite");
        yield* press({
          kind: "button",
          customId: `mb:act:accept:${invite?.id}`,
          as: BOB.discordId,
        });
        const live = yield* h.surface.card(invite?.id ?? "");
        expect(Option.map(live, (v) => v.state)).toEqual(Option.some("live"));
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "draws the Link confirmation in the account's Chosen Skin",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)], linked: false });
        const PINK = "/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink";
        yield* h.chosenSkins.pick(ALICE.steamId, PINK);
        const drawn: Array<{ steamId: string; skin: ChosenSkin }> = [];
        const renderer = Layer.succeed(Renderer, {
          link: (preview: ProfilePreview, skin: ChosenSkin) => {
            drawn.push({ steamId: preview.steamId, skin });
            return Effect.succeed(Buffer.from("png"));
          },
        } as unknown as Renderer);
        const press = yield* driven(h, renderer);
        const answers = yield* press({
          kind: "modal",
          customId: controlId({ _tag: "LinkForm" }),
          as: ALICE.discordId,
          fields: { [PROFILE_FIELD]: "https://steamcommunity.com/id/alice" },
        });
        expect(answers.map((a) => a.method)).toEqual(["deferReply", "editReply"]);
        expect(drawn).toEqual([{ steamId: ALICE.steamId, skin: PINK }]);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "answers See my stats privately: the card, and Pair again turns it into a sign-in link",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const press = yield* driven(h);
        const controls = (answers: ReadonlyArray<{ message: unknown }>) =>
          controlsOf((answers.at(-1)?.message as { components?: [] }).components).map((c) => [
            c.label,
            c.target,
          ]);

        const seen = yield* press({
          kind: "button",
          customId: controlId({ _tag: "SeeMyStats" }),
          as: ALICE.discordId,
        });
        expect(seen.map((a) => a.method)).toEqual(["deferReply", "editReply"]);
        expect(controls(seen)).toEqual([
          ["Player page", `${SITE}/player/${ALICE.steamId}`],
          ["Not you? Pair again", "mb:statsagain"],
        ]);

        const again = yield* press({
          kind: "button",
          customId: "mb:statsagain",
          as: ALICE.discordId,
        });
        expect(again.map((a) => a.method)).toEqual(["deferUpdate", "editReply"]);
        expect(controls(again)).toEqual([["Sign in with Steam", `${SITE}/discord/link?t=token1`]]);
      }).pipe(Effect.scoped),
    30_000,
  );
});

describe("the Weekly Cup's buttons", () => {
  const CUP = { guildId: "g-racing", week: "2026-10-26" };
  /** One server's Cup that answers each press with what it was given. */
  const fakeCups = () => {
    const pressed: Array<string> = [];
    const cups = WeeklyCups.of({
      in: (guildId) =>
        Effect.succeed(
          guildId !== CUP.guildId
            ? Option.none()
            : Option.some({
                signUp: (week, who) =>
                  Effect.sync(() => void pressed.push(`signUp ${week} ${who}`)).pipe(
                    Effect.as(`signed up ${who}`),
                  ),
                withdraw: (_week, who) => Effect.succeed(`withdrew ${who}`),
                vote: (week, who, picks) =>
                  Effect.sync(
                    () => void pressed.push(`vote ${week} ${who} ${picks.join(",")}`),
                  ).pipe(Effect.as(`voted ${picks.join(", ")}`)),
                askSkip: (week, _who, manageServer) =>
                  Effect.succeed<SkipAsk>(
                    manageServer
                      ? { _tag: "Confirm", week }
                      : { _tag: "Refused", text: "admins only" },
                  ),
                skip: (week, who, manageServer) =>
                  Effect.sync(() => void pressed.push(`skip ${week} ${who} ${manageServer}`)).pipe(
                    Effect.as("skipped"),
                  ),
              }),
        ),
    });
    return { cups, pressed };
  };
  const contentOf = (answers: ReadonlyArray<{ message: unknown }>) =>
    (answers.at(-1)?.message as { content?: string } | null)?.content;

  it.live(
    "signs a linked member up, answering privately",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const cup = fakeCups();
        const press = yield* driven(h, Renderer.Default, cup.cups);
        const answers = yield* press({
          kind: "button",
          customId: controlId({ _tag: "CupSignUp", ...CUP }),
          as: ALICE.discordId,
        });
        expect(answers.map((a) => a.method)).toEqual(["deferReply", "editReply"]);
        expect(contentOf(answers)).toBe(`signed up ${ALICE.discordId}`);
        const out = yield* press({
          kind: "button",
          customId: controlId({ _tag: "CupWithdraw", ...CUP }),
          as: ALICE.discordId,
        });
        expect(contentOf(out)).toBe(`withdrew ${ALICE.discordId}`);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "walks a member without a Link through Link Steam, then signs them up",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)], linked: false });
        const cup = fakeCups();
        const press = yield* driven(h, Renderer.Default, cup.cups);
        const first = yield* press({
          kind: "button",
          customId: controlId({ _tag: "CupSignUp", ...CUP }),
          as: ALICE.discordId,
        });
        expect(first.map((a) => a.method)).toEqual(["showModal"]);
        expect(cup.pressed).toEqual([]);
        yield* press({
          kind: "modal",
          customId: controlId({ _tag: "LinkForm" }),
          as: ALICE.discordId,
          fields: { [PROFILE_FIELD]: "https://steamcommunity.com/id/alice" },
        });
        const linked = yield* press({
          kind: "button",
          customId: controlId({ _tag: "ConfirmLink" }),
          as: ALICE.discordId,
        });
        expect(contentOf(linked)).toBe(`signed up ${ALICE.discordId}`);
        expect(cup.pressed).toEqual([`signUp ${CUP.week} ${ALICE.discordId}`]);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "asks a server admin to confirm Skip, and passes on who may manage the server",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const cup = fakeCups();
        const press = yield* driven(h, Renderer.Default, cup.cups);
        const skip = controlId({ _tag: "CupSkip", ...CUP });
        const member = yield* press({ kind: "button", customId: skip, as: BOB.discordId });
        // Deferred before the Cup's lock is waited on, as every Cup press is.
        expect(member.map((a) => a.method)).toEqual(["deferReply", "editReply"]);
        expect(contentOf(member)).toBe("admins only");
        const admin = yield* press({
          kind: "button",
          customId: skip,
          as: ALICE.discordId,
          manageServer: true,
        });
        const confirm = controlsOf(admin.at(-1)?.message?.components).map((c) => c.target);
        expect(confirm).toEqual([controlId({ _tag: "CupConfirmSkip", ...CUP })]);
        const done = yield* press({
          kind: "button",
          customId: confirm[0] ?? "",
          as: ALICE.discordId,
          manageServer: true,
        });
        expect(done.map((a) => a.method)).toEqual(["deferUpdate", "editReply"]);
        expect(contentOf(done)).toBe("skipped");
        expect(cup.pressed).toEqual([`skip ${CUP.week} ${ALICE.discordId} true`]);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "passes on a vote's picks and answers privately",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const cup = fakeCups();
        const press = yield* driven(h, Renderer.Default, cup.cups);
        const answers = yield* press({
          kind: "select",
          customId: controlId({ _tag: "CupVote", ...CUP }),
          as: BOB.discordId,
          values: ["pf3", "pf7"],
        });
        expect(answers.map((a) => a.method)).toEqual(["deferReply", "editReply"]);
        expect(contentOf(answers)).toBe("voted pf3, pf7");
        expect(cup.pressed).toEqual([`vote ${CUP.week} ${BOB.discordId} pf3,pf7`]);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "says so in a server where the Cup isn't running",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const press = yield* driven(h, Renderer.Default, fakeCups().cups);
        const answers = yield* press({
          kind: "button",
          customId: controlId({ _tag: "CupSignUp", guildId: "g-other", week: CUP.week }),
          as: ALICE.discordId,
        });
        expect(contentOf(answers)).toBe("The Weekly Cup isn't running in this server right now.");
      }).pipe(Effect.scoped),
    30_000,
  );
});
