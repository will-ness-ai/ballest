import { describe, expect, it } from "@effect/vitest"
import { type Control, controlId, parseControl } from "../src/discord/controls.js"

const EVERY_KIND: ReadonlyArray<Control> = [
  { _tag: "NewMatch" },
  { _tag: "LinkSteam" },
  { _tag: "PickType", type: "challenge" },
  { _tag: "PickTarget" },
  { _tag: "PickDuration", request: { type: "challenge", target: "123456789012345678", minutes: 15 } },
  { _tag: "OpenInvite", request: { type: "lobby", target: null, minutes: 60 } },
  { _tag: "Act", action: "decline", matchId: "42" },
  { _tag: "ConfirmLink" },
  { _tag: "LinkForm" }
]

describe("button and form ids", () => {
  it("read back as the Control they were written from, for every kind", () => {
    for (const control of EVERY_KIND) expect(parseControl(controlId(control))).toEqual(control)
  })

  it("fit Discord's 100-character limit", () => {
    for (const control of EVERY_KIND) expect(controlId(control).length).toBeLessThanOrEqual(100)
  })

  it("are unique per kind", () => {
    expect(new Set(EVERY_KIND.map((c) => controlId(c))).size).toBe(EVERY_KIND.length)
  })

  it("ignore ids that aren't ours or no longer make sense", () => {
    for (const id of ["", "other:new", "mb", "mb:nope", "mb:type:solo", "mb:dur:lobby:-:7", "mb:act:explode:1", "mb:act:join"])
      expect(parseControl(id)).toBeNull()
  })
})
