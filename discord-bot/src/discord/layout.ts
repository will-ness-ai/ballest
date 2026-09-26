// Where things sit in the bot's channel, as pure planning: given what's posted now and what
// just happened, the Discord operations to run. The adapter runs them and records the ids.
//
// The rules (spec #21, stories 19-22, 31, 38):
// - The Footer is always the channel's last message.
// - A new Match Card is made by editing the Footer into it, then posting a fresh Footer, so
//   Cards read top to bottom in the order their Invites opened. Several Invites at once just
//   repeat that, one after another, and still end with a single Footer below them.
// - An expired, cancelled or declined Invite loses its Card and its Match Thread.
// - An Invite cancelled because no Map is eligible keeps both, its Card saying why, so every
//   Player in it can see what happened.
// - A Card is forgotten once it will never change again: after its Result, or once closed.
import { Data } from "effect"
import type { RemovalReason } from "../ports.js"

export interface CardRef {
  readonly messageId: string
  /** Null while the Match Thread couldn't be started yet; the next thread post starts it. */
  readonly threadId: string | null
}

export interface Layout {
  readonly footerId: string | null
  readonly cards: ReadonlyMap<string, CardRef>
}

export const emptyLayout: Layout = { footerId: null, cards: new Map() }

export type Op = Data.TaggedEnum<{
  /**
   * Turn the Footer message into this Match's Card and start its Match Thread on it. If the
   * Footer turns out to be gone, the adapter posts the Card fresh instead.
   */
  FooterBecomesCard: { readonly matchId: string; readonly messageId: string }
  /** Post this Match's Card as a new message (no Footer to reuse) and start its Match Thread. */
  PostCard: { readonly matchId: string }
  EditCard: { readonly matchId: string; readonly messageId: string }
  /** Edit the Card into a cancelled notice with no buttons, and forget it. */
  CloseCard: { readonly matchId: string; readonly messageId: string }
  PostFooter: {}
  DeleteMessage: { readonly messageId: string }
  DeleteThread: { readonly threadId: string }
}>
export const Op = Data.taggedEnum<Op>()

/** What running an op created on Discord. */
export interface Created {
  readonly messageId?: string
  readonly threadId?: string
}

/** A Card to draw: redraw it in place if it exists, else it takes the Footer's place. */
export const planShowCard = (layout: Layout, matchId: string): ReadonlyArray<Op> => {
  const card = layout.cards.get(matchId)
  if (card !== undefined) return [Op.EditCard({ matchId, messageId: card.messageId })]
  if (layout.footerId !== null) return [Op.FooterBecomesCard({ matchId, messageId: layout.footerId }), Op.PostFooter()]
  return [Op.PostCard({ matchId }), Op.PostFooter()]
}

/** An Invite that never became a Match. The Footer stays last either way. */
export const planRemove = (layout: Layout, matchId: string, reason: RemovalReason): ReadonlyArray<Op> => {
  const card = layout.cards.get(matchId)
  if (card === undefined) return []
  if (reason === "noEligibleMap") return [Op.CloseCard({ matchId, messageId: card.messageId })]
  const deleteThread = card.threadId === null ? [] : [Op.DeleteThread({ threadId: card.threadId })]
  return [...deleteThread, Op.DeleteMessage({ messageId: card.messageId })]
}

/**
 * On startup: the Footer must be the channel's last message. If it's missing, or something
 * was posted after it while the bot was down, replace it.
 */
export const planStartup = (layout: Layout, lastMessageId: string | null): ReadonlyArray<Op> => {
  if (layout.footerId !== null && layout.footerId === lastMessageId) return []
  return layout.footerId === null ? [Op.PostFooter()] : [Op.DeleteMessage({ messageId: layout.footerId }), Op.PostFooter()]
}

const withCard = (layout: Layout, matchId: string, card: CardRef): Layout => ({
  ...layout,
  cards: new Map(layout.cards).set(matchId, card)
})

/** The layout without a Card, once nothing will change it again. */
export const forget = (layout: Layout, matchId: string): Layout => {
  const cards = new Map(layout.cards)
  cards.delete(matchId)
  return { ...layout, cards }
}

/** A Match Thread started late, on the next thread post. */
export const withThread = (layout: Layout, matchId: string, threadId: string): Layout => {
  const card = layout.cards.get(matchId)
  return card === undefined ? layout : withCard(layout, matchId, { ...card, threadId })
}

/**
 * The layout after an op ran. `created` carries the ids Discord gave anything new; a Card
 * whose Footer was gone comes back with its own `messageId`.
 */
export const applyOp = (layout: Layout, op: Op, created: Created): Layout =>
  Op.$match(op, {
    FooterBecomesCard: ({ matchId, messageId }) =>
      withCard({ ...layout, footerId: null }, matchId, {
        messageId: created.messageId ?? messageId,
        threadId: created.threadId ?? null
      }),
    PostCard: ({ matchId }) =>
      created.messageId === undefined
        ? layout
        : withCard(layout, matchId, { messageId: created.messageId, threadId: created.threadId ?? null }),
    EditCard: () => layout,
    CloseCard: ({ matchId }) => forget(layout, matchId),
    PostFooter: () => ({ ...layout, footerId: created.messageId ?? null }),
    DeleteMessage: ({ messageId }) => ({
      footerId: layout.footerId === messageId ? null : layout.footerId,
      cards: new Map([...layout.cards].filter(([, c]) => c.messageId !== messageId))
    }),
    DeleteThread: () => layout
  })
