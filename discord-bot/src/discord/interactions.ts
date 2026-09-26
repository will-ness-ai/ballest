// Button clicks, pickers and forms, turned into engine actions. Every answer is private to the
// member who clicked; the channel and Match Threads only change through the Surface.
import {
  MessageFlags,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction
} from "discord.js"
import { Effect, Layer, Match, Option, Ref, Stream } from "effect"
import { Engine, type Rejection } from "../engine.js"
import { Store, type ProfilePreview } from "../ports.js"
import { Renderer } from "../render/renderer.js"
import { Discord, type DiscordError, tryDiscord } from "./client.js"
import { type Action, parseControl } from "./controls.js"
import {
  linkForm,
  linkPreviewMessage,
  pickDurationMessage,
  pickTargetMessage,
  pickTypeMessage,
  PROFILE_FIELD,
  quiet,
  tryAgainMessage
} from "./messages.js"

/** What a member was doing when they had to link Steam first; it runs once they've linked. */
type Pending = { readonly _tag: "NewMatch" } | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string }

/** A rejection in words, for the member who clicked. */
const explain = (e: Rejection, self: string): string =>
  Match.valueTags(e, {
    NotLinked: ({ discordId }) => (discordId === self ? "Link your Steam account first." : `<@${discordId}> hasn't linked Steam yet.`),
    Busy: ({ discordId }) =>
      discordId === self
        ? "You're already in an open Invite or a live Match."
        : `<@${discordId}> is already in an open Invite or a live Match.`,
    MatchNotFound: () => "That Invite is gone.",
    NotOpen: () => "That Invite isn't open anymore.",
    NotAllowed: ({ reason }) => reason,
    NotEnoughPlayers: ({ min }) => `A Lobby needs at least ${min} Players to start.`,
    NoEligibleMap: () =>
      "No Map fits this Match: someone here has finished every candidate, or none suits the length. The Invite is closed.",
    SteamUnavailable: () => "Steam didn't answer. Try again in a moment.",
    ProfileNotFound: ({ reason }) => reason
  })

const ephemeral = { flags: MessageFlags.Ephemeral } as const

type Answerable = ButtonInteraction | ModalSubmitInteraction

export const InteractionsLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const discord = yield* Discord
    const engine = yield* Engine
    const store = yield* Store
    const renderer = yield* Renderer
    const previews = yield* Ref.make(new Map<string, ProfilePreview>())
    const pending = yield* Ref.make(new Map<string, Pending>())

    const isLinked = Effect.fn("isLinked")(function* (discordId: string) {
      return Option.isSome(yield* store.getLink(discordId))
    })
    const remember = Effect.fn("remember")(function* (discordId: string, next: Pending | null) {
      yield* Ref.update(pending, (m) => {
        const updated = new Map(m)
        if (next === null) updated.delete(discordId)
        else updated.set(discordId, next)
        return updated
      })
    })
    const takePending = Effect.fn("takePending")(function* (discordId: string) {
      const found = Option.fromNullable((yield* Ref.get(pending)).get(discordId))
      yield* remember(discordId, null)
      return found
    })

    const showLinkForm = (i: ButtonInteraction) => tryDiscord("show link form", () => i.showModal(linkForm()))

    const runAction = (action: Action, discordId: string, matchId: string) =>
      Match.value(action).pipe(
        Match.when("accept", () => engine.accept(discordId, matchId)),
        Match.when("decline", () => engine.decline(discordId, matchId)),
        Match.when("join", () => engine.join(discordId, matchId)),
        Match.when("leave", () => engine.leave(discordId, matchId)),
        Match.when("start", () => engine.start(discordId, matchId)),
        Match.when("cancel", () => engine.cancel(discordId, matchId)),
        Match.exhaustive
      )

    /** Run a Card action; a rejection is explained privately to whoever clicked. */
    const act = Effect.fn("act")(function* (i: Answerable, action: Action, matchId: string) {
      yield* runAction(action, i.user.id, matchId).pipe(
        Effect.asVoid,
        Effect.catchAll((e) => tryDiscord("follow up", () => i.followUp({ content: explain(e, i.user.id), ...ephemeral, ...quiet })))
      )
    })

    const confirmLink = Effect.fn("confirmLink")(function* (i: ButtonInteraction) {
      const self = i.user.id
      yield* tryDiscord("defer", () => i.deferUpdate())
      const preview = (yield* Ref.get(previews)).get(self)
      if (preview === undefined)
        return yield* tryDiscord("edit reply", () => i.editReply(tryAgainMessage("That check expired. Paste your profile again.")))
      const linked = yield* engine.confirmLink(self, preview).pipe(Effect.either)
      if (linked._tag === "Left")
        return yield* tryDiscord("edit reply", () => i.editReply({ content: explain(linked.left, self), embeds: [], components: [] }))
      yield* tryDiscord("edit reply", () => i.editReply({ content: `Linked to **${preview.personaName}**.`, embeds: [], components: [] }))
      // Carry on with whatever needed the Link.
      const next = yield* takePending(self)
      if (Option.isNone(next)) return
      if (next.value._tag === "NewMatch") return yield* tryDiscord("follow up", () => i.followUp({ ...pickTypeMessage(), ...ephemeral }))
      yield* act(i, next.value.action, next.value.matchId)
    })

    const onButton = Effect.fn("onButton")(function* (i: ButtonInteraction) {
      const control = parseControl(i.customId)
      const self = i.user.id
      if (control === null) return
      switch (control._tag) {
        case "NewMatch":
          if (!(yield* isLinked(self))) {
            yield* remember(self, { _tag: "NewMatch" })
            return yield* showLinkForm(i)
          }
          return yield* tryDiscord("reply", () => i.reply({ ...pickTypeMessage(), ...ephemeral }))
        case "PickType":
          return yield* tryDiscord("update", () =>
            i.update(control.type === "challenge" ? pickTargetMessage() : pickDurationMessage(control.type, null, null))
          )
        case "PickDuration":
          return yield* tryDiscord("update", () => {
            const { type, target, minutes } = control.request
            return i.update(pickDurationMessage(type, target, minutes))
          })
        case "OpenInvite": {
          yield* tryDiscord("defer", () => i.deferUpdate())
          const text = yield* engine.openInvite(self, control.request).pipe(
            Effect.as("Invite opened. It's in the channel now."),
            Effect.catchAll((e) => Effect.succeed(explain(e, self)))
          )
          return yield* tryDiscord("edit reply", () => i.editReply({ content: text, components: [], ...quiet }))
        }
        case "Act": {
          const needsLink = control.action === "accept" || control.action === "join"
          if (needsLink && !(yield* isLinked(self))) {
            yield* remember(self, { _tag: "Act", action: control.action, matchId: control.matchId })
            return yield* showLinkForm(i)
          }
          yield* tryDiscord("defer", () => i.deferUpdate())
          return yield* act(i, control.action, control.matchId)
        }
        case "LinkSteam":
          // Linking on its own, so nothing asked for earlier (and abandoned) runs afterwards.
          yield* remember(self, null)
          return yield* showLinkForm(i)
        case "ConfirmLink":
          return yield* confirmLink(i)
        default:
          return
      }
    })

    const onPickTarget = Effect.fn("onPickTarget")(function* (i: UserSelectMenuInteraction) {
      const target = i.values[0]
      if (target === undefined) return
      if (target === i.user.id)
        return yield* tryDiscord("update", () => i.update({ ...pickTargetMessage(), content: "**Challenge · who?** Not yourself." }))
      yield* tryDiscord("update", () => i.update(pickDurationMessage("challenge", target, null)))
    })

    const onLinkForm = Effect.fn("onLinkForm")(function* (i: ModalSubmitInteraction) {
      yield* tryDiscord("defer", () => i.deferReply(ephemeral))
      const input = i.fields.getTextInputValue(PROFILE_FIELD)
      const found = yield* engine.previewLink(input).pipe(Effect.either)
      if (found._tag === "Left") return yield* tryDiscord("edit reply", () => i.editReply(tryAgainMessage(explain(found.left, i.user.id))))
      yield* Ref.update(previews, (m) => new Map(m).set(i.user.id, found.right))
      const png = yield* renderer.link(found.right)
      yield* tryDiscord("edit reply", () => i.editReply(linkPreviewMessage(png)))
    })

    const route = (i: Interaction): Effect.Effect<void, DiscordError> => {
      if (i.isButton()) return Effect.asVoid(onButton(i))
      if (i.isUserSelectMenu() && parseControl(i.customId)?._tag === "PickTarget") return onPickTarget(i)
      if (i.isModalSubmit() && parseControl(i.customId)?._tag === "LinkForm") return Effect.asVoid(onLinkForm(i))
      return Effect.void
    }

    const handle = (i: Interaction) =>
      route(i).pipe(
        Effect.catchAllCause((cause) => Effect.logError(`interaction ${"customId" in i ? i.customId : i.type} failed`, cause))
      )

    yield* discord.interactions.pipe(
      Stream.mapEffect((i) => handle(i), { concurrency: "unbounded" }),
      Stream.runDrain,
      Effect.forkScoped
    )
  })
)
