import { describe, expect, it } from "@effect/vitest"
import { applyOp, emptyLayout, type Layout, type Op, planRemove, planShowCard, planStartup } from "../src/discord/layout.js"

/** A fake channel: runs ops the way Discord would, handing out ids, and keeps the message order. */
const channel = () => {
  let next = 1
  let layout: Layout = emptyLayout
  const messages: Array<{ id: string; kind: string }> = []
  const run = (ops: ReadonlyArray<Op>) => {
    for (const op of ops) {
      const created: { messageId?: string; threadId?: string } = {}
      switch (op._tag) {
        case "PostFooter":
          created.messageId = `msg${next++}`
          messages.push({ id: created.messageId, kind: "footer" })
          break
        case "PostCard":
          created.messageId = `msg${next++}`
          created.threadId = `thr${next++}`
          messages.push({ id: created.messageId, kind: `card ${op.matchId}` })
          break
        case "FooterBecomesCard": {
          created.threadId = `thr${next++}`
          const m = messages.find((x) => x.id === op.messageId)
          if (m) m.kind = `card ${op.matchId}`
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
    remove: (matchId: string) => run(planRemove(layout, matchId)),
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
    expect(planRemove(c.layout(), "m1").map((o) => o._tag)).toEqual(["DeleteThread", "DeleteMessage"])
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
})
