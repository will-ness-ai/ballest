import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { parseProfileInput } from "../src/steam/steamLive.js"

describe("a pasted Steam profile", () => {
  it.each([
    ["76561198047685844", { _tag: "SteamId", steamId: "76561198047685844" }],
    ["https://steamcommunity.com/profiles/76561198047685844/", { _tag: "SteamId", steamId: "76561198047685844" }],
    ["https://steamcommunity.com/id/ChknThugget/", { _tag: "Vanity", name: "ChknThugget" }],
    ["steamcommunity.com/id/ChknThugget", { _tag: "Vanity", name: "ChknThugget" }],
    ["  ChknThugget  ", { _tag: "Vanity", name: "ChknThugget" }]
  ])("%s", (input, expected) => {
    expect(parseProfileInput(input)).toEqual(Option.some(expected))
  })

  it.each(["https://example.com/foo bar", "", "a"])("rejects %j", (input) => {
    expect(Option.isNone(parseProfileInput(input))).toBe(true)
  })
})
