// Button clicks, pickers and forms, turned into engine actions. Every answer is private to the
// member who clicked; the channel and Match Threads only change through the Surface.
import {
  MessageFlags,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction
} from "discord.js"
import { Effect, Layer, Option, Ref, Stream } from "effect"
import { Engine, type InviteRequest } from "../engine.js"
import { Store, type ProfilePreview } from "../ports.js"
import { Discord, tryDiscord } from "./client.js"
import {
  linkForm,
  linkPreviewMessage,
  parseControl,
  pickDurationMessage,
  pickTargetMessage,
  pickTypeMessage,
  PROFILE_FIELD,
  tryAgainMessage,
  type Action
} from "./messages.js"

/** What a member was doing when they had to link Steam first; it runs once they've linked. */
type Pending = { readonly _tag: "NewMatch" } | { readonly _tag: "Act"; readonly action: Action; readonly matchId: string }

type Rejection = { readonly _tag: string; readonly discordId?: string; readonly reason?: string }

/** A rejection in words, for the member who clicked. */
const explain = (e: Rejection, self: string): string => {
  switch (e._tag) {
    case "NotLinked":
      return e.discordId === self ? "Link your Steam account first." : `<@${e.discordId}> hasn't linked Steam yet.`
    case "Busy":
      return e.discordId === self
        ? "You're already in an open Invite or a live Match."
        : `<@${e.discordId}> is already in an open Invite or a live Match.`
    case "MatchNotFound":
      return "That Invite is gone."
    case "NotOpen":
      return "That Invite isn't open anymore."
    case "NotEnoughPlayers":
      return "A Lobby needs at least 2 Players to start."
    case "NoEligibleMap":
      return "No Map fits this Match: someone here has finished every candidate, or none suits the length. The Invite is closed."
    case "SteamUnavailable":
      return "Steam didn't answer. Try again in a moment."
    default:
      return e.reason ?? "That didn't work."
  }
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const
const quiet = { allowedMentions: { parse: [] } } as const

export const InteractionsLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const discord = yield* Discord
    const engine = yield* Engine
    const store = yield* Store
    const previews = yield* Ref.make(new Map<string, ProfilePreview>())
    const pending = yield* Ref.make(new Map<string, Pending>())

    const isLinked = (discordId: string) => store.getLink(discordId).pipe(Effect.map(Option.isSome))
    const remember = (discordId: string, p: Pending) => Ref.update(pending, (m) => new Map(m).set(discordId, p))
    const takePending = (discordId: string) =>
      Ref.modify(pending, (m) => {
        const next = new Map(m)
        next.delete(discordId)
        return [Option.fromNullable(m.get(discordId)), next] as const
      })

    const runAction = (action: Action, discordId: string, matchId: string) =>
      Effect.gen(function* () {
        switch (action) {
          case "accept":
            return yield* engine.accept(discordId, matchId)
          case "decline":
            return yield* engine.decline(discordId, matchId)
          case "join":
            return yield* engine.join(discordId, matchId)
          case "leave":
            return yield* engine.leave(discordId, matchId)
          case "start":
            return yield* engine.start(discordId, matchId)
          case "cancel":
            return yield* engine.cancel(discordId, matchId)
        }
      })

    const onButton = (i: ButtonInteraction) =>
      Effect.gen(function* () {
        const control = parseControl(i.customId)
        const self = i.user.id
        if (control === null) return
        switch (control._tag) {
          case "NewMatch":
            if (!(yield* isLinked(self))) {
              yield* remember(self, { _tag: "NewMatch" })
              return yield* tryDiscord("show link form", () => i.showModal(linkForm()))
            }
            return yield* tryDiscord("reply", () => i.reply({ ...pickTypeMessage(), ...ephemeral }))
          case "PickType":
            return yield* tryDiscord("update", () =>
              i.update(control.type === "challenge" ? pickTargetMessage() : pickDurationMessage(control.type, null, null))
            )
          case "PickDuration":
            return yield* tryDiscord("update", () => i.update(pickDurationMessage(control.type, control.target, control.minutes)))
          case "OpenInvite": {
            yield* tryDiscord("defer", () => i.deferUpdate())
            const request: InviteRequest = { type: control.type, minutes: control.minutes, target: control.target }
            const text = yield* engine.openInvite(self, request).pipe(
              Effect.as("Invite opened. It's in the channel now."),
              Effect.catchAll((e) => Effect.succeed(explain(e, self)))
            )
            return yield* tryDiscord("edit reply", () => i.editReply({ content: text, components: [], ...quiet }))
          }
          case "Act": {
            const needsLink = control.action === "accept" || control.action === "join"
            if (needsLink && !(yield* isLinked(self))) {
              yield* remember(self, { _tag: "Act", action: control.action, matchId: control.matchId })
              return yield* tryDiscord("show link form", () => i.showModal(linkForm()))
            }
            yield* tryDiscord("defer", () => i.deferUpdate())
            yield* runAction(control.action, self, control.matchId).pipe(
              Effect.catchAll((e) => tryDiscord("follow up", () => i.followUp({ content: explain(e, self), ...ephemeral, ...quiet })))
            )
            return
          }
          case "LinkSteam":
            return yield* tryDiscord("show link form", () => i.showModal(linkForm()))
          case "ConfirmLink": {
            yield* tryDiscord("defer", () => i.deferUpdate())
            const preview = (yield* Ref.get(previews)).get(self)
            if (preview === undefined)
              return yield* tryDiscord("edit reply", () => i.editReply(tryAgainMessage("That check expired. Paste your profile again.")))
            const linked = yield* engine.confirmLink(self, preview).pipe(Effect.either)
            if (linked._tag === "Left")
              return yield* tryDiscord("edit reply", () => i.editReply({ content: explain(linked.left, self), embeds: [], components: [] }))
            yield* tryDiscord("edit reply", () =>
              i.editReply({ content: `Linked to **${preview.personaName}**.`, embeds: [], components: [] })
            )
            // Carry on with whatever needed the Link.
            const next = yield* takePending(self)
            if (Option.isNone(next)) return
            if (next.value._tag === "NewMatch") return yield* tryDiscord("follow up", () => i.followUp({ ...pickTypeMessage(), ...ephemeral }))
            const { action, matchId } = next.value
            yield* runAction(action, self, matchId).pipe(
              Effect.catchAll((e) => tryDiscord("follow up", () => i.followUp({ content: explain(e, self), ...ephemeral, ...quiet })))
            )
            return
          }
          default:
            return
        }
      })

    const onPickTarget = (i: UserSelectMenuInteraction) =>
      Effect.gen(function* () {
        const target = i.values[0]
        if (target === undefined) return
        if (target === i.user.id)
          return yield* tryDiscord("update", () => i.update({ ...pickTargetMessage(), content: "**Challenge · who?** Not yourself." }))
        yield* tryDiscord("update", () => i.update(pickDurationMessage("challenge", target, null)))
      })

    const onLinkForm = (i: ModalSubmitInteraction) =>
      Effect.gen(function* () {
        yield* tryDiscord("defer", () => i.deferReply(ephemeral))
        const input = i.fields.getTextInputValue(PROFILE_FIELD)
        const found = yield* engine.previewLink(input).pipe(Effect.either)
        if (found._tag === "Left") return yield* tryDiscord("edit reply", () => i.editReply(tryAgainMessage(explain(found.left, i.user.id))))
        yield* Ref.update(previews, (m) => new Map(m).set(i.user.id, found.right))
        yield* tryDiscord("edit reply", () => i.editReply(linkPreviewMessage(found.right)))
      })

    const handle = (i: Interaction) => {
      const work: Effect.Effect<unknown, unknown> = i.isButton()
        ? onButton(i)
        : i.isUserSelectMenu() && parseControl(i.customId)?._tag === "PickTarget"
          ? onPickTarget(i)
          : i.isModalSubmit() && parseControl(i.customId)?._tag === "LinkForm"
            ? onLinkForm(i)
            : Effect.void
      return work.pipe(
        Effect.catchAllCause((cause) => Effect.logError(`interaction ${"customId" in i ? i.customId : i.type} failed`, cause))
      )
    }

    yield* discord.interactions.pipe(Stream.mapEffect(handle, { concurrency: "unbounded" }), Stream.runDrain, Effect.forkScoped)
  })
)
