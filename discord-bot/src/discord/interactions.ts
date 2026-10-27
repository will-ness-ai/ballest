// Button clicks, pickers and forms, turned into engine actions. Every answer is private to the
// member who clicked; the channel and Match Threads only change through the Surface. Each click
// is handled in its Venue: New Match opens the Invite there, and Pings is that server's role.
import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { Context, Effect, Layer, Match, Option, Ref, Stream } from "effect";
import { Engine } from "../engine.js";
import { explain } from "../explain.js";
import { Pings, warnPingRole } from "../pings.js";
import { roleNamed } from "../pingWords.js";
import { ChosenSkins, chosenSkinOf, MatchLinks, Store, type ProfilePreview } from "../ports.js";
import { Renderer, type RenderError } from "../render/renderer.js";
import { type Member, SeeMyStats, type StatsAnswer } from "../seeMyStats.js";
import { type CupAnswer, type CupPresses, WeeklyCups } from "../weeklyCup/schedule.js";
import {
  describeDiscordError,
  Discord,
  type DiscordError,
  type DiscordVenue,
  oneLine,
  tryDiscord,
  type VenueInteraction,
} from "./client.js";
import { type Action, parseControl } from "./controls.js";
import {
  confirmLeaveMessage,
  cupConfirmSkipMessage,
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
  playAgainText,
  PROFILE_FIELD,
  quiet,
  statsAnswerMessage,
  tryAgainMessage,
  withPingFailure,
} from "./messages.js";

/** What a member was doing when they had to link Steam first; it runs once they've linked. */
type Pending =
  | { readonly _tag: "NewMatch" }
  | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string }
  | { readonly _tag: "PlayAgain"; readonly matchId: string }
  /** Sign up for a server's Weekly Cup. */
  | { readonly _tag: "CupSignUp"; readonly guildId: string; readonly week: string };

const CUP_NOT_HERE = "The Weekly Cup isn't running in this server right now.";

const ephemeral = { flags: MessageFlags.Ephemeral } as const;

type Answerable = ButtonInteraction | ModalSubmitInteraction;

/**
 * Clicks and forms that come from somewhere other than Discord, handled exactly like Discord's:
 * the sandbox's driver (scripts/sandbox.ts), which presses buttons as any member. Absent in
 * production and `pnpm dev`.
 */
export class DriverInteractions extends Context.Tag("multiballs/DriverInteractions")<
  DriverInteractions,
  Stream.Stream<VenueInteraction>
>() {}

export const InteractionsLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const discord = yield* Discord;
    const engine = yield* Engine;
    const store = yield* Store;
    const renderer = yield* Renderer;
    const chosenSkins = yield* ChosenSkins;
    const links = yield* MatchLinks;
    const pings = yield* Pings;
    const stats = yield* SeeMyStats;
    const cups = yield* WeeklyCups;
    /** A Venue's @Multiplayer ping role, as the words mention and name it. */
    const pingRoleIn = (venue: DiscordVenue) => ({
      id: venue.pingRoleId,
      name: roleNamed(venue.pingRoleName),
    });
    const previews = yield* Ref.make(new Map<string, ProfilePreview>());
    const pending = yield* Ref.make(new Map<string, Pending>());

    const isLinked = Effect.fn("isLinked")(function* (discordId: string) {
      return Option.isSome(yield* store.getLink(discordId));
    });
    const remember = Effect.fn("remember")(function* (discordId: string, next: Pending | null) {
      yield* Ref.update(pending, (m) => {
        const updated = new Map(m);
        if (next === null) updated.delete(discordId);
        else updated.set(discordId, next);
        return updated;
      });
    });
    const takePending = Effect.fn("takePending")(function* (discordId: string) {
      const found = Option.fromNullable((yield* Ref.get(pending)).get(discordId));
      yield* remember(discordId, null);
      return found;
    });

    const showLinkForm = (i: ButtonInteraction) =>
      tryDiscord("show link form", () => i.showModal(linkForm()));

    /**
     * An unlinked member is shown the link form, and `next` runs once they've linked: true when
     * that happened, so the click is answered already.
     */
    const linkFirst = Effect.fn("linkFirst")(function* (i: ButtonInteraction, next: Pending) {
      if (yield* isLinked(i.user.id)) return false;
      yield* remember(i.user.id, next);
      yield* showLinkForm(i);
      return true;
    });

    const runAction = (action: Action, discordId: string, matchId: string) =>
      Match.value(action).pipe(
        Match.when("accept", () => engine.accept(discordId, matchId)),
        Match.when("decline", () => engine.decline(discordId, matchId)),
        Match.when("join", () => engine.join(discordId, matchId)),
        Match.when("leave", () => engine.leave(discordId, matchId)),
        Match.when("start", () => engine.start(discordId, matchId)),
        Match.when("cancel", () => engine.cancel(discordId, matchId)),
        Match.exhaustive,
      );

    /**
     * Discord refused a Get or Remove: say so on the same private reply, keeping its buttons to
     * try again, rather than in a new message.
     */
    const pingFailed = Effect.fn("pingFailed")(function* (
      i: ButtonInteraction,
      venue: DiscordVenue,
    ) {
      yield* tryDiscord("edit reply", () =>
        i.editReply({ content: withPingFailure(i.message.content, pingRoleIn(venue)), ...quiet }),
      );
    });

    /** After an action went through: offer the ping role, if this action and member are due it. */
    const offerPings = Effect.fn("offerPings")(function* (
      i: Answerable,
      venue: DiscordVenue,
      action: Action,
    ) {
      if (yield* pings.offerAfter(venue.name, action, i.user.id))
        yield* tryDiscord("follow up", () =>
          i.followUp({ ...pingOfferMessage(pingRoleIn(venue)), ...ephemeral }),
        );
    });

    /** Run a Card action; a rejection is explained privately to whoever clicked. */
    const act = Effect.fn("act")(function* (
      i: Answerable,
      venue: DiscordVenue,
      action: Action,
      matchId: string,
    ) {
      const done = yield* runAction(action, i.user.id, matchId).pipe(
        Effect.as(true),
        Effect.catchAll((e) =>
          tryDiscord("follow up", () =>
            i.followUp({ content: explain(e, i.user.id), ...ephemeral, ...quiet }),
          ).pipe(Effect.as(false)),
        ),
      );
      if (done) yield* offerPings(i, venue, action);
    });

    /**
     * Play again on a finished Match, pressed in `venue` (the finished Match's): the presser is
     * told privately where its Lobby's thread is, and, if they opened it, that the Start is theirs.
     */
    const playAgain = Effect.fn("playAgain")(function* (
      i: Answerable,
      venue: DiscordVenue,
      matchId: string,
    ) {
      const done = yield* engine.playAgain(i.user.id, matchId).pipe(Effect.either);
      if (done._tag === "Left")
        return yield* tryDiscord("follow up", () =>
          i.followUp({ content: explain(done.left, i.user.id), ...ephemeral, ...quiet }),
        );
      const { lobbyId, creator, joinedNow } = done.right;
      const thread = Option.flatMapNullable(
        yield* links.of(venue.name, lobbyId),
        (p) => p.threadId,
      );
      yield* tryDiscord("follow up", () =>
        i.followUp({
          content: playAgainText(creator, Option.getOrNull(thread)),
          ...ephemeral,
          ...quiet,
        }),
      );
      if (joinedNow && !creator) yield* offerPings(i, venue, "join");
    });

    /** A press on a server's Weekly Cup post, answered in words; none there if it isn't running. */
    const cupAnswer = Effect.fn("cupAnswer")(function* (
      guildId: string,
      press: (cup: CupPresses) => Effect.Effect<CupAnswer>,
    ) {
      const cup = yield* cups.in(guildId);
      if (Option.isNone(cup)) return { _tag: "Text", text: CUP_NOT_HERE } satisfies CupAnswer;
      return yield* press(cup.value);
    });
    const cupText = Effect.fn("cupText")(function* (
      guildId: string,
      press: (cup: CupPresses) => Effect.Effect<CupAnswer>,
    ) {
      const answer = yield* cupAnswer(guildId, press);
      // Only Skip asks to confirm; anything else is words.
      return answer._tag === "Text" ? answer.text : CUP_NOT_HERE;
    });
    /** Answer a Cup press privately, deferred first: it redraws the post. */
    const cupReply = Effect.fn("cupReply")(function* (
      i: ButtonInteraction,
      guildId: string,
      press: (cup: CupPresses) => Effect.Effect<CupAnswer>,
    ) {
      yield* tryDiscord("defer", () => i.deferReply(ephemeral));
      const content = yield* cupText(guildId, press);
      yield* tryDiscord("edit reply", () => i.editReply({ content, ...quiet }));
    });
    /** Whether the member who pressed holds Manage Server where they pressed. */
    const managesServer = (i: ButtonInteraction) =>
      i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

    const confirmLink = Effect.fn("confirmLink")(function* (
      i: ButtonInteraction,
      venue: DiscordVenue,
    ) {
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
      if (next.value._tag === "PlayAgain") return yield* playAgain(i, venue, next.value.matchId);
      if (next.value._tag === "CupSignUp") {
        const { guildId, week } = next.value;
        const text = yield* cupText(guildId, (cup) => cup.signUp(week, self));
        return yield* tryDiscord("follow up", () =>
          i.followUp({ content: text, ...ephemeral, ...quiet }),
        );
      }
      yield* act(i, venue, next.value.action, next.value.matchId);
    });

    /** See my stats's private answer, on the reply this click deferred: shown, then replaced. */
    const statsAnswer = (i: ButtonInteraction) => (answer: StatsAnswer) =>
      tryDiscord("edit reply", () => i.editReply(statsAnswerMessage(answer))).pipe(Effect.asVoid);
    const memberOf = (i: ButtonInteraction): Member => ({ id: i.user.id, name: i.user.username });

    /** A button pressed in `venue`'s channel or one of its Match Threads: it acts there. */
    const onButton = Effect.fn("onButton")(function* (i: ButtonInteraction, venue: DiscordVenue) {
      const pingRole = pingRoleIn(venue);
      const control = parseControl(i.customId);
      const self = i.user.id;
      if (control === null) return;
      switch (control._tag) {
        case "NewMatch":
          if (yield* linkFirst(i, { _tag: "NewMatch" })) return;
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
          const text = yield* engine.openInvite(venue.name, self, control.request).pipe(
            Effect.as("Invite opened. It's in the channel now."),
            Effect.catchAll((e) => Effect.succeed(explain(e, self))),
          );
          return yield* tryDiscord("edit reply", () =>
            i.editReply({ content: text, components: [], ...quiet }),
          );
        }
        case "Act": {
          const needsLink = control.action === "accept" || control.action === "join";
          if (needsLink && (yield* linkFirst(i, control))) return;
          yield* tryDiscord("defer", () => i.deferUpdate());
          return yield* act(i, venue, control.action, control.matchId);
        }
        case "PlayAgain":
          if (yield* linkFirst(i, control)) return;
          yield* tryDiscord("defer", () => i.deferUpdate());
          return yield* playAgain(i, venue, control.matchId);
        case "LinkSteam":
          // Linking on its own, so nothing asked for earlier (and abandoned) runs afterwards.
          yield* remember(self, null);
          return yield* showLinkForm(i);
        case "ConfirmLink":
          return yield* confirmLink(i, venue);
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
            Effect.catchAll((e) => Effect.succeed(explain(e, self))),
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
          const answer = yield* pings.status(venue.name, self).pipe(
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
          return yield* pings.set(venue.name, self, control.on).pipe(
            Effect.zipRight(
              tryDiscord("edit reply", () => i.editReply(pingsMessage(control.on, pingRole))),
            ),
            Effect.catchTag("PingRoleUnavailable", (e) =>
              warnPingRole(e).pipe(Effect.zipRight(pingFailed(i, venue))),
            ),
          );
        }
        case "DeclinePing":
          yield* pings.decline(venue.name, self);
          return yield* tryDiscord("update", () => i.update(pingDeclinedMessage()));
        case "SeeMyStats":
          // Deferred first: the card takes the site a few seconds to draw.
          yield* tryDiscord("defer", () => i.deferReply(ephemeral));
          return yield* stats.see(memberOf(i), statsAnswer(i));
        case "PairAgain":
          // The card's own answer becomes the sign-in link, and the card again once paired.
          yield* tryDiscord("defer", () => i.deferUpdate());
          return yield* stats.pairAgain(memberOf(i), statsAnswer(i));
        case "CupSignUp":
          if (yield* linkFirst(i, control)) return;
          return yield* cupReply(i, control.guildId, (cup) => cup.signUp(control.week, self));
        case "CupWithdraw":
          return yield* cupReply(i, control.guildId, (cup) => cup.withdraw(control.week, self));
        case "CupSkip": {
          const answer = yield* cupAnswer(control.guildId, (cup) =>
            cup.askSkip(control.week, self, managesServer(i)),
          );
          const message =
            answer._tag === "ConfirmSkip"
              ? cupConfirmSkipMessage(control.guildId, answer.week)
              : { content: answer.text, ...quiet };
          return yield* tryDiscord("reply", () => i.reply({ ...message, ...ephemeral }));
        }
        case "CupConfirmSkip": {
          // The confirmation becomes the answer.
          yield* tryDiscord("defer", () => i.deferUpdate());
          const content = yield* cupText(control.guildId, (cup) =>
            cup.skip(control.week, self, managesServer(i)),
          );
          return yield* tryDiscord("edit reply", () =>
            i.editReply({ content, components: [], ...quiet }),
          );
        }
        default:
          return;
      }
    });

    const onPickTarget = Effect.fn("onPickTarget")(function* (i: UserSelectMenuInteraction) {
      const target = i.values[0];
      if (target === undefined) return;
      if (target === i.user.id)
        return yield* tryDiscord("update", () =>
          i.update({ ...pickTargetMessage(), content: "**Challenge · who?** Not yourself." }),
        );
      yield* tryDiscord("update", () => i.update(pickDurationMessage("challenge", target, null)));
    });

    const onLinkForm = Effect.fn("onLinkForm")(function* (i: ModalSubmitInteraction) {
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

    const route = (
      i: Interaction,
      venue: DiscordVenue,
    ): Effect.Effect<void, DiscordError | RenderError> => {
      if (i.isButton()) return Effect.asVoid(onButton(i, venue));
      if (i.isUserSelectMenu() && parseControl(i.customId)?._tag === "PickTarget")
        return onPickTarget(i);
      if (i.isModalSubmit() && parseControl(i.customId)?._tag === "LinkForm")
        return Effect.asVoid(onLinkForm(i));
      return Effect.void;
    };

    const label = (i: Interaction) => ("customId" in i ? i.customId : String(i.type));

    // Each click comes with the Venue it plays in: Discord's from the channel it came from, the
    // sandbox driver's from where its feed is built (home).
    const handle = ({ interaction: i, venue }: VenueInteraction) =>
      route(i, venue).pipe(
        // A Discord or drawing failure is one line; a defect is a bug, so it keeps its stack.
        Effect.catchAll((e) =>
          Effect.logError(
            `interaction ${label(i)} failed: ${e._tag === "DiscordError" ? describeDiscordError(e) : oneLine(e.cause)}`,
          ),
        ),
        Effect.catchAllDefect((defect) =>
          Effect.logError(`interaction ${label(i)} failed`, defect),
        ),
      );

    const driver = yield* Effect.serviceOption(DriverInteractions);
    const all = Option.match(driver, {
      onNone: () => discord.interactions,
      onSome: (d) => Stream.merge(discord.interactions, d),
    });
    yield* all.pipe(
      Stream.mapEffect((clicked) => handle(clicked), { concurrency: "unbounded" }),
      Stream.runDrain,
      Effect.forkScoped,
    );
  }),
);
