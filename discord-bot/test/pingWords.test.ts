// What Lobby pings say when Discord won't answer: a read that failed isn't a change that failed.
import { describe, expect, it } from "vitest";
import { getPing, pingFailed, pingUnread, removePing } from "../src/pingWords.js";

describe("Lobby pings words", () => {
  it("says a change failed only when a change was asked for", () => {
    expect(pingFailed("@Multiplayer ping")).toBe(
      "Discord didn't change @Multiplayer ping. Try again in a moment.",
    );
    expect(pingUnread("@Multiplayer ping")).toBe(
      "Discord didn't say whether you have @Multiplayer ping. Try again in a moment.",
    );
  });

  it("names the role as the server does", () => {
    expect(getPing("@Multiplayer Pings")).toBe("Get @Multiplayer Pings");
    expect(removePing("@Multiplayer Pings")).toBe("Remove @Multiplayer Pings");
  });
});
