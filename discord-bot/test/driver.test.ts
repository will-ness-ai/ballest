// The sandbox driver (scripts/sandbox/driver.ts) through InteractionsLive: its stand-in
// Interaction runs a click exactly as Discord's would, so a Player's whole path from New Match to
// a live Match can be pressed, and what the bot answered privately comes back in Discord's shape.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";
import { Discord } from "../src/discord/client.js";
import { DriverInteractions, InteractionsLive } from "../src/discord/interactions.js";
import { Engine } from "../src/engine.js";
import { Pings } from "../src/pings.js";
import { controlId } from "../src/discord/controls.js";
import { PROFILE_FIELD } from "../src/discord/messages.js";
import { ChosenSkins, type ChosenSkin, type ProfilePreview, Store } from "../src/ports.js";
import { Renderer } from "../src/render/renderer.js";
import { OpsAlerts } from "../src/ops.js";
import { makeSeeMyStats, SeeMyStats, StatsLinks, StatsSite } from "../src/seeMyStats.js";
import { controlsOf, fromPayload } from "../scripts/axi/describe.js";
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
      Layer.succeed(OpsAlerts, OpsAlerts.make({ configured: false, post: () => Effect.void })),
    ),
  ),
);

/**
 * InteractionsLive over the harness's engine, fed by the driver: `press` clicks or submits as a
 * member and reads back every private answer in Discord's message shape.
 */
const driven = (h: Harness, renderer: Layer.Layer<Renderer> = Renderer.Default) =>
  Effect.gen(function* () {
    const queue: Array<(i: unknown) => void> = [];
    const feed = Stream.async<never>(
      (emit) => void queue.push((i) => void emit.single(i as never)),
    );
    const discord = Layer.succeed(Discord, Discord.make({ interactions: Stream.empty } as never));
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
            renderer,
            seeMyStats,
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
