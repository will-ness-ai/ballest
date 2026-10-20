// Button clicks, pickers and forms, turned into engine actions. Every answer is private to the
// member who clicked; the channel and Match Threads only change through the Surface.
import {
  MessageFlags,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { Context, Effect, Layer, Match, Option, Ref, Stream } from "effect";
import { Engine, isRejection, type Rejection } from "../engine.js";
import { explain } from "../explain.js";
import { Pings, warnPingRole } from "../pings.js";
import { ChosenSkins, chosenSkinOf, Store, type ProfilePreview } from "../ports.js";
import { Renderer } from "../render/renderer.js";
import { describeDiscordError, Discord, oneLine, tryDiscord } from "./client.js";
import { type Action, parseControl } from "./controls.js";
import {
  confirmLeaveMessage,
  LEFT_TEXT,
  linkForm,
  linkPreviewMessage,
  pickDurationMessage,
  pickTargetMessage,
  pickTypeMessage,
  pingDeclinedMessage,
  pingOfferMessage,
  pingsMessage,
  pingUnreadMessage,
  PROFILE_FIELD,
  quiet,
  tryAgainMessage,
  withPingFailure,
} from "./messages.js";

/** What a member was doing when they had to link Steam first; it runs once they've linked. */
type Pending =
  | { readonly _tag: "NewMatch" }
  | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string };

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

type Answerable = ButtonInteraction | ModalSubmitInteraction;

/**
 * Clicks and forms that come from somewhere other than Discord, handled exactly like Discord's:
 * the sandbox's driver (scripts/sandbox.ts), which presses buttons as any member. Absent in
 * production and `pnpm dev`.
 */
export class DriverInteractions extends Context.Tag("multiballs/DriverInteractions")<
  DriverInteractions,
  Stream.Stream<Interaction>
>() {}

export const InteractionsLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const discord = yield* Discord;
    const engine = yield* Engine;
    const store = yield* Store;
    const renderer = yield* Renderer;
    const chosenSkins = yield* ChosenSkins;
    const pings = yield* Pings;
    const pingRole = { id: discord.pingRoleId, name: pings.role };
    const previews = yield* Ref.make(new Map<string, ProfilePreview>());
    const pending = yield* Ref.make(new Map<string, Pending>());

    const isLinked = Effect.fn("Interactions.isLinked")(function* (discordId: string) {
      return Option.isSome(yield* store.getLink(discordId));
    });
    const remember = Effect.fn("Interactions.remember")(function* (
      discordId: string,
      next: Pending | null,
    ) {
      yield* Ref.update(pending, (m) => {
        const updated = new Map(m);
        if (next === null) updated.delete(discordId);
        else updated.set(discordId, next);
        return updated;
      });
    });
    const takePending = Effect.fn("Interactions.takePending")(function* (discordId: string) {
      const found = Option.fromNullable((yield* Ref.get(pending)).get(discordId));
      yield* remember(discordId, null);
      return found;
    });

    const showLinkForm = Effect.fn("Interactions.showLinkForm")(function* (i: ButtonInteraction) {
      return yield* tryDiscord("show link form", () => i.showModal(linkForm()));
    });

    const runAction = Effect.fn("Interactions.runAction")(function* (
      action: Action,
      discordId: string,
      matchId: string,
    ) {
      return yield* Match.value(action).pipe(
        Match.when("accept", () => engine.accept(discordId, matchId)),
        Match.when("decline", () => engine.decline(discordId, matchId)),
        Match.when("join", () => engine.join(discordId, matchId)),
        Match.when("leave", () => engine.leave(discordId, matchId)),
        Match.when("start", () => engine.start(discordId, matchId)),
        Match.when("cancel", () => engine.cancel(discordId, matchId)),
        Match.exhaustive,
      );
    });

    /**
     * Discord refused a Get or Remove: say so on the same private reply, keeping its buttons to
     * try again, rather than in a new message.
     */
    const pingFailed = Effect.fn("Interactions.pingFailed")(function* (i: ButtonInteraction) {
      yield* tryDiscord("edit reply", () =>
        i.editReply({ content: withPingFailure(i.message.content, pingRole), ...quiet }),
      );
    });

    /** After an action went through: offer the ping role, if this action and member are due it. */
    const offerPings = Effect.fn("Interactions.offerPings")(function* (
      i: Answerable,
      action: Action,
    ) {
      if (yield* pings.offerAfter(action, i.user.id))
        yield* tryDiscord("follow up", () =>
          i.followUp({ ...pingOfferMessage(pingRole), ...ephemeral }),
        );
    });

    /** A rejection, explained privately to whoever clicked. */
    const turnedDown = Effect.fn("Interactions.turnedDown")(function* (
      i: Answerable,
      e: Rejection,
    ) {
      yield* tryDiscord("follow up", () =>
        i.followUp({ content: explain(e, i.user.id), ...ephemeral, ...quiet }),
      );
      return false;
    });

    /** Run a Card action; a rejection is explained privately to whoever clicked. */
    const act = Effect.fn("Interactions.act")(function* (
      i: Answerable,
      action: Action,
      matchId: string,
    ) {
      const done = yield* runAction(action, i.user.id, matchId).pipe(
        Effect.as(true),
        Effect.catchIf(isRejection, (e) => turnedDown(i, e)),
      );
      if (done) yield* offerPings(i, action);
    });

    const confirmLink = Effect.fn("Interactions.confirmLink")(function* (i: ButtonInteraction) {
      const self = i.user.id;
      yield* tryDiscord("defer", () => i.deferUpdate());
      const preview = (yield* Ref.get(previews)).get(self);
      if (preview === undefined)
        return yield* tryDiscord("edit reply", () =>
          i.editReply(tryAgainMessage("That check expired. Paste your profile again.")),
        );
      const linked = yield* engine.confirmLink(self, preview).pipe(Effect.either);
      if (linked._tag === "Left")
        return yield* tryDiscord("edit reply", () =>
          i.editReply({ content: explain(linked.left, self), embeds: [], components: [] }),
        );
      yield* tryDiscord("edit reply", () =>
        i.editReply({
          content: `Linked to **${preview.personaName}**.`,
          embeds: [],
          components: [],
        }),
      );
      // Carry on with whatever needed the Link.
      const next = yield* takePending(self);
      if (Option.isNone(next)) return;
      if (next.value._tag === "NewMatch")
        return yield* tryDiscord("follow up", () =>
          i.followUp({ ...pickTypeMessage(), ...ephemeral }),
        );
      yield* act(i, next.value.action, next.value.matchId);
    });

    const onButton = Effect.fn("Interactions.onButton")(function* (i: ButtonInteraction) {
      const control = parseControl(i.customId);
      const self = i.user.id;
      if (control === null) return;
      switch (control._tag) {
        case "NewMatch":
          if (!(yield* isLinked(self))) {
            yield* remember(self, { _tag: "NewMatch" });
            return yield* showLinkForm(i);
          }
          return yield* tryDiscord("reply", () => i.reply({ ...pickTypeMessage(), ...ephemeral }));
        case "PickType":
          return yield* tryDiscord("update", () =>
            i.update(
              control.type === "challenge"
                ? pickTargetMessage()
                : pickDurationMessage(control.type, null, null),
            ),
          );
        case "PickDuration":
          return yield* tryDiscord("update", () => {
            const { type, target, minutes } = control.request;
            return i.update(pickDurationMessage(type, target, minutes));
          });
        case "OpenInvite": {
          yield* tryDiscord("defer", () => i.deferUpdate());
          const text = yield* engine.openInvite(self, control.request).pipe(
            Effect.as("Invite opened. It's in the channel now."),
            Effect.catchIf(isRejection, (e) => Effect.succeed(explain(e, self))),
          );
          return yield* tryDiscord("edit reply", () =>
            i.editReply({ content: text, components: [], ...quiet }),
          );
        }
        case "Act": {
          const needsLink = control.action === "accept" || control.action === "join";
          if (needsLink && !(yield* isLinked(self))) {
            yield* remember(self, {
              _tag: "Act",
              action: control.action,
              matchId: control.matchId,
            });
            return yield* showLinkForm(i);
          }
          yield* tryDiscord("defer", () => i.deferUpdate());
          return yield* act(i, control.action, control.matchId);
        }
        case "LinkSteam":
          // Linking on its own, so nothing asked for earlier (and abandoned) runs afterwards.
          yield* remember(self, null);
          return yield* showLinkForm(i);
        case "ConfirmLink":
          return yield* confirmLink(i);
        case "AskLeave": {
          const allowed = yield* engine.mayLeave(self, control.matchId).pipe(Effect.either);
          const message =
            allowed._tag === "Left"
              ? { content: explain(allowed.left, self), ...quiet }
              : confirmLeaveMessage(control.matchId);
          return yield* tryDiscord("reply", () => i.reply({ ...message, ...ephemeral }));
        }
        case "ConfirmLeave": {
          yield* tryDiscord("defer", () => i.deferUpdate());
          const text = yield* engine.leave(self, control.matchId).pipe(
            Effect.as(LEFT_TEXT),
            Effect.catchIf(isRejection, (e) => Effect.succeed(explain(e, self))),
          );
          return yield* tryDiscord("edit reply", () =>
            i.editReply({ content: text, components: [], ...quiet }),
          );
        }
        case "Stay":
          return yield* tryDiscord("update", () =>
            i.update({ content: "Still racing.", components: [] }),
          );
        case "Pings": {
          // Read from Discord on every click, so a moderator's change shows.
          yield* tryDiscord("defer", () => i.deferReply(ephemeral));
          const answer = yield* pings.status(self).pipe(
            Effect.map((on) => pingsMessage(on, pingRole)),
            Effect.catchTag("PingRoleUnavailable", (e) =>
              warnPingRole(e).pipe(Effect.as(pingUnreadMessage(pingRole))),
            ),
          );
          return yield* tryDiscord("edit reply", () => i.editReply(answer));
        }
        case "SetPing": {
          // The Pings reply or the offer it's on becomes the Pings reply for the new state.
          yield* tryDiscord("defer", () => i.deferUpdate());
          return yield* pings.set(self, control.on).pipe(
            Effect.zipRight(
              tryDiscord("edit reply", () => i.editReply(pingsMessage(control.on, pingRole))),
            ),
            Effect.catchTag("PingRoleUnavailable", (e) =>
              warnPingRole(e).pipe(Effect.zipRight(pingFailed(i))),
            ),
          );
        }
        case "DeclinePing":
          yield* pings.decline(self);
          return yield* tryDiscord("update", () => i.update(pingDeclinedMessage()));
        default:
          return;
      }
    });

    const onPickTarget = Effect.fn("Interactions.onPickTarget")(function* (
      i: UserSelectMenuInteraction,
    ) {
      const target = i.values[0];
      if (target === undefined) return;
      if (target === i.user.id)
        return yield* tryDiscord("update", () =>
          i.update({ ...pickTargetMessage(), content: "**Challenge · who?** Not yourself." }),
        );
      yield* tryDiscord("update", () => i.update(pickDurationMessage("challenge", target, null)));
    });

    const onLinkForm = Effect.fn("Interactions.onLinkForm")(function* (i: ModalSubmitInteraction) {
      yield* tryDiscord("defer", () => i.deferReply(ephemeral));
      const input = i.fields.getTextInputValue(PROFILE_FIELD);
      const found = yield* engine.previewLink(input).pipe(Effect.either);
      if (found._tag === "Left")
        return yield* tryDiscord("edit reply", () =>
          i.editReply(tryAgainMessage(explain(found.left, i.user.id))),
        );
      yield* Ref.update(previews, (m) => new Map(m).set(i.user.id, found.right));
      const png = yield* renderer.link(
        found.right,
        chosenSkinOf(yield* chosenSkins.all, found.right.steamId),
      );
      yield* tryDiscord("edit reply", () => i.editReply(linkPreviewMessage(png)));
    });

    const route = Effect.fn("Interactions.route")(function* (i: Interaction) {
      if (i.isButton()) yield* onButton(i);
      else if (i.isUserSelectMenu() && parseControl(i.customId)?._tag === "PickTarget")
        yield* onPickTarget(i);
      else if (i.isModalSubmit() && parseControl(i.customId)?._tag === "LinkForm")
        yield* onLinkForm(i);
    });

    const label = (i: Interaction) => ("customId" in i ? i.customId : String(i.type));

    const handle = Effect.fn("Interactions.handle")(function* (i: Interaction) {
      return yield* route(i).pipe(
        // A Discord or drawing failure is one line; a defect is a bug, so it keeps its stack.
        Effect.catchTags({
          DiscordError: (e) =>
            Effect.logError(`interaction ${label(i)} failed: ${describeDiscordError(e)}`),
          RenderError: (e) =>
            Effect.logError(`interaction ${label(i)} failed: ${oneLine(e.cause)}`),
        }),
        Effect.catchAllDefect((defect) =>
          Effect.logError(`interaction ${label(i)} failed`, defect),
        ),
      );
    });

    const driver = yield* Effect.serviceOption(DriverInteractions);
    const all = Option.match(driver, {
      onNone: () => discord.interactions,
      onSome: (d) => Stream.merge(discord.interactions, d),
    });
    yield* all.pipe(
      // Effect<void>: a failure handle doesn't recover is a type error, not a stopped stream
      Stream.mapEffect((i): Effect.Effect<void> => handle(i), { concurrency: "unbounded" }),
      Stream.runDrain,
      Effect.forkScoped,
    );
  }),
);
