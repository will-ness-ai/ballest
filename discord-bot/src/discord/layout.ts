// Where things sit in the bot's channel, as pure planning: given what's posted now and what
// just happened, the Discord operations to run. The adapter runs them and records the ids.
//
// The rules (spec #21, stories 19-22):
// - The Footer is always the channel's last message.
// - A new Match Card is made by editing the Footer into it, then posting a fresh Footer, so
//   Cards read top to bottom in the order their Invites opened. Several Invites at once just
//   repeat that, one after another, and still end with a single Footer below them.
// - An Invite that never became a Match loses its Card and its Match Thread.
import { Data } from "effect"

export interface CardRef {
  readonly messageId: string
  readonly threadId: string
}

export interface Layout {
  readonly footerId: string | null
  readonly cards: ReadonlyMap<string, CardRef>
}

export const emptyLayout: Layout = { footerId: null, cards: new Map() }

export type Op = Data.TaggedEnum<{
  /** Turn the Footer message into this Match's Card and start its Match Thread on it. */
  FooterBecomesCard: { readonly matchId: string; readonly messageId: string }
  /** Post this Match's Card as a new message (no Footer to reuse) and start its Match Thread. */
  PostCard: { readonly matchId: string }
  EditCard: { readonly matchId: string; readonly messageId: string }
  PostFooter: {}
  DeleteMessage: { readonly messageId: string }
  DeleteThread: { readonly threadId: string }
}>
export const Op = Data.taggedEnum<Op>()

/** A Card to draw: redraw it in place if it exists, else it takes the Footer's place. */
export const planShowCard = (layout: Layout, matchId: string): ReadonlyArray<Op> => {
  const card = layout.cards.get(matchId)
  if (card !== undefined) return [Op.EditCard({ matchId, messageId: card.messageId })]
  if (layout.footerId !== null) return [Op.FooterBecomesCard({ matchId, messageId: layout.footerId }), Op.PostFooter()]
  return [Op.PostCard({ matchId }), Op.PostFooter()]
}

/** An Invite that never became a Match: its thread and Card go. The Footer stays last. */
export const planRemove = (layout: Layout, matchId: string): ReadonlyArray<Op> => {
  const card = layout.cards.get(matchId)
  return card === undefined ? [] : [Op.DeleteThread({ threadId: card.threadId }), Op.DeleteMessage({ messageId: card.messageId })]
}

/**
 * On startup: the Footer must be the channel's last message. If it's missing, or something
 * was posted after it while the bot was down, replace it.
 */
export const planStartup = (layout: Layout, lastMessageId: string | null): ReadonlyArray<Op> => {
  if (layout.footerId !== null && layout.footerId === lastMessageId) return []
  return layout.footerId === null ? [Op.PostFooter()] : [Op.DeleteMessage({ messageId: layout.footerId }), Op.PostFooter()]
}

/** The layout after an op ran. `created` carries the ids Discord gave anything new. */
export const applyOp = (
  layout: Layout,
  op: Op,
  created: { readonly messageId?: string; readonly threadId?: string }
): Layout =>
  Op.$match(op, {
    FooterBecomesCard: ({ matchId, messageId }) => ({
      footerId: null,
      cards: new Map(layout.cards).set(matchId, { messageId, threadId: created.threadId ?? "" })
    }),
    PostCard: ({ matchId }) => ({
      ...layout,
      cards: new Map(layout.cards).set(matchId, { messageId: created.messageId ?? "", threadId: created.threadId ?? "" })
    }),
    EditCard: () => layout,
    PostFooter: () => ({ ...layout, footerId: created.messageId ?? null }),
    DeleteMessage: ({ messageId }) => ({
      footerId: layout.footerId === messageId ? null : layout.footerId,
      cards: new Map([...layout.cards].filter(([, c]) => c.messageId !== messageId))
    }),
    DeleteThread: () => layout
  })
