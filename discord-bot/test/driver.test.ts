// The sandbox driver (scripts/sandbox/driver.ts) through InteractionsLive: its stand-in
// Interaction runs a click exactly as Discord's would, so a Player's whole path from New Match to
// a live Match can be pressed, and what the bot answered privately comes back in Discord's shape.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";
import { Discord } from "../src/discord/client.js";
import { DriverInteractions, InteractionsLive } from "../src/discord/interactions.js";
import { Engine } from "../src/engine.js";
import { Pings } from "../src/pings.js";
import { Store } from "../src/ports.js";
import { Renderer } from "../src/render/renderer.js";
import { controlsOf, fromPayload } from "../scripts/axi/describe.js";
import { fakeInteraction, type Press } from "../scripts/sandbox/driver.js";
import { ALICE, BOB, makeHarness, makeMap } from "./harness.js";

describe("the sandbox driver", () => {
  it.live(
    "presses a Player from New Match to a live Match",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ maps: [makeMap(1)] });
        const queue: Array<(i: unknown) => void> = [];
        const feed = Stream.async<never>(
          (emit) => void queue.push((i) => void emit.single(i as never)),
        );
        const discord = Layer.succeed(
          Discord,
          Discord.make({ interactions: Stream.empty } as never),
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
                Renderer.Default,
              ),
            ),
          ),
        );
        yield* Effect.sleep("50 millis");

        /** Press, and read back every private answer in Discord's message shape. */
        const press = (p: Press) =>
          Effect.promise(async () => {
            const { interaction, settled } = fakeInteraction(p, "c1");
            for (const push of queue) push(interaction);
            return (await settled).map((c) => ({
              method: c.method,
              message: c.payload === undefined ? null : fromPayload(c.method, c.payload),
            }));
          });
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
});
