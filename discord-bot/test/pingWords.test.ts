// What Lobby pings say when Discord won't answer: a read that failed isn't a change that failed.
import { describe, expect, it } from "vitest";
import { PING_FAILED, PING_UNREAD, pingsHave, pingsToast } from "../src/pingWords.js";

describe("Lobby pings words", () => {
  it("says a change failed only when a change was asked for", () => {
    expect(PING_FAILED).toBe("Discord didn't change @Multiplayer ping. Try again in a moment.");
    expect(PING_UNREAD).toBe(
      "Discord didn't say whether you have @Multiplayer ping. Try again in a moment.",
    );
  });

  it("the bell's toast says what the Pings reply says", () => {
    expect(pingsToast(true)).toBe("You have @Multiplayer ping.");
    expect(pingsToast(false)).toBe("You don't have @Multiplayer ping.");
    expect(pingsToast(true)).toBe(pingsHave(true, "@Multiplayer ping"));
  });
});
