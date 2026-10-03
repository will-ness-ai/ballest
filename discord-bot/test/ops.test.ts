import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { tokenDaysLeft } from "../src/ops.js";

const DAY_MS = 86_400_000;
const jwt = (claims: object) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("the Steam refresh token's expiry", () => {
  const now = Date.UTC(2026, 8, 26);

  it("counts whole days left", () => {
    expect(tokenDaysLeft(jwt({ exp: (now + 30.5 * DAY_MS) / 1000 }), now)).toEqual(Option.some(30));
  });

  it("goes negative once expired", () => {
    expect(tokenDaysLeft(jwt({ exp: (now - DAY_MS) / 1000 }), now)).toEqual(Option.some(-1));
  });

  it.each(["not-a-jwt", "a.b.c", jwt({ sub: "no exp" })])("can't read %j", (token) => {
    expect(Option.isNone(tokenDaysLeft(token, now))).toBe(true);
  });
});
