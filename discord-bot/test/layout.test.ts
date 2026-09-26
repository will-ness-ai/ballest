import { describe, expect, it } from "@effect/vitest"
import type { RemovalReason } from "../src/ports.js"
import {
  applyOp,
  type Created,
  emptyLayout,
  forget,
  type Layout,
  type Op,
  planRemove,
  planShowCard,
  planStartup,
  withThread
} from "../src/discord/layout.js"

/**
 * A fake channel: runs ops the way Discord would, handing out ids, and keeps the message order.
 * `threadFails` makes thread starts fail, as a flaky Discord would.
 */
const channel = (opts: { threadFails?: boolean } = {}) => {
  let next = 1
  let layout: Layout = emptyLayout
  const messages: Array<{ id: string; kind: string }> = []
  const run = (ops: ReadonlyArray<Op>) => {
    for (const op of ops) {
      const created: { -readonly [K in keyof Created]: Created[K] } = {}
      const thread = () => (opts.threadFails ? undefined : `thr${next++}`)
      switch (op._tag) {
        case "PostFooter":
          created.messageId = `msg${next++}`
          messages.push({ id: created.messageId, kind: "footer" })
          break
        case "PostCard": {
          created.messageId = `msg${next++}`
          const t = thread()
          if (t) created.threadId = t
          messages.push({ id: created.messageId, kind: `card ${op.matchId}` })
          break
        }
        case "FooterBecomesCard": {
          const m = messages.find((x) => x.id === op.messageId)
          // The adapter falls back to posting the Card when the Footer is gone.
          if (m) m.kind = `card ${op.matchId}`
          else {
            created.messageId = `msg${next++}`
            messages.push({ id: created.messageId, kind: `card ${op.matchId}` })
          }
          const t = thread()
          if (t) created.threadId = t
          break
        }
        case "CloseCard": {
          const m = messages.find((x) => x.id === op.messageId)
          if (m) m.kind = `closed ${op.matchId}`
          break
        }
        case "DeleteMessage": {
          const i = messages.findIndex((x) => x.id === op.messageId)
          if (i >= 0) messages.splice(i, 1)
          break
        }
        default:
          break
      }
      layout = applyOp(layout, op, created)
    }
  }
  return {
    show: (matchId: string) => run(planShowCard(layout, matchId)),
    remove: (matchId: string, reason: RemovalReason = "expired") => run(planRemove(layout, matchId, reason)),
    deleteByHand: (id: string) => {
      const i = messages.findIndex((x) => x.id === id)
      if (i >= 0) messages.splice(i, 1)
    },
    startup: (last: string | null) => run(planStartup(layout, last)),
    postByAnyone: () => messages.push({ id: `msg${next++}`, kind: "someone else" }),
    order: () => messages.map((m) => m.kind),
    last: () => messages.at(-1)?.id ?? null,
    layout: () => layout
  }
}

describe("channel layout", () => {
  it("posts a Footer on first start", () => {
    const c = channel()
    c.startup(null)
    expect(c.order()).toEqual(["footer"])
  })

  it("turns the Footer into each new Card and keeps a single Footer last", () => {
    const c = channel()
    c.startup(null)
    c.show("m1")
    c.show("m2")
    c.show("m3")
    expect(c.order()).toEqual(["card m1", "card m2", "card m3", "footer"])
  })

  it("redraws an existing Card in place", () => {
    const c = channel()
    c.startup(null)
    c.show("m1")
    const before = c.layout().cards.get("m1")
    expect(planShowCard(c.layout(), "m1")).toEqual([{ _tag: "EditCard", matchId: "m1", messageId: before?.messageId }])
  })

  it("deletes a dropped Invite's Card and thread, and the Footer stays last", () => {
    const c = channel()
    c.startup(null)
    c.show("m1")
    c.show("m2")
    const card = c.layout().cards.get("m1")
    expect(planRemove(c.layout(), "m1", "declined").map((o) => o._tag)).toEqual(["DeleteThread", "DeleteMessage"])
    c.remove("m1")
    expect(c.order()).toEqual(["card m2", "footer"])
    expect(c.layout().cards.has("m1")).toBe(false)
    expect(card?.threadId).toMatch(/^thr/)
  })

  it("leaves the Footer alone on restart when it's still last", () => {
    const c = channel()
    c.startup(null)
    expect(planStartup(c.layout(), c.last())).toEqual([])
  })

  it("replaces the Footer on restart if something was posted after it", () => {
    const c = channel()
    c.startup(null)
    c.show("m1")
    c.postByAnyone()
    c.startup(c.last())
    expect(c.order()).toEqual(["card m1", "someone else", "footer"])
  })

  it("posts a Card fresh when there is no Footer to reuse", () => {
    const c = channel()
    c.show("m1")
    expect(c.order()).toEqual(["card m1", "footer"])
  })

  it("keeps a Card cancelled for want of a Map, saying why, and forgets it", () => {
    const c = channel()
    c.startup(null)
    c.show("m1")
    c.remove("m1", "noEligibleMap")
    expect(c.order()).toEqual(["closed m1", "footer"])
    expect(c.layout().cards.has("m1")).toBe(false)
  })

  it("posts the Card fresh when the Footer was deleted by hand", () => {
    const c = channel()
    c.startup(null)
    const footer = c.layout().footerId
    if (footer !== null) c.deleteByHand(footer)
    c.show("m1")
    expect(c.order()).toEqual(["card m1", "footer"])
    expect(c.layout().cards.get("m1")?.threadId).toMatch(/^thr/)
  })

  it("records a Card whose thread failed to start, so a later post can start it", () => {
    const c = channel({ threadFails: true })
    c.startup(null)
    c.show("m1")
    expect(c.layout().cards.get("m1")?.threadId).toBeNull()
    expect(planRemove(c.layout(), "m1", "cancelled").map((o) => o._tag)).toEqual(["DeleteMessage"])
    expect(withThread(c.layout(), "m1", "thr9").cards.get("m1")?.threadId).toBe("thr9")
  })

  it("forgets a finished Match's Card", () => {
    const c = channel()
    c.startup(null)
    c.show("m1")
    expect(forget(c.layout(), "m1").cards.size).toBe(0)
  })
})
