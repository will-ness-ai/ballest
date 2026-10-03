// What `pnpm axi` shows of a message, from either source: Discord's own message object, and a
// payload the bot answered privately (read back through fromPayload).
import { describe, expect, it } from "vitest";
import { detail, fromPayload, summary, table } from "../scripts/axi/describe.js";
import {
  linkForm,
  pickDurationMessage,
  pickTypeMessage,
  threadMessage,
} from "../src/discord/messages.js";
import { ThreadPost } from "../src/ports.js";
import { ALICE, BOB } from "./harness.js";

const NO_MARBLES = { marbles: { forHue: () => "", forPlayer: () => "" }, png: null };

describe("axi's message reader", () => {
  it("lists a Card in one line: its clock, its image and its buttons", () => {
    const card = {
      id: "1",
      author: { id: "b", username: "Multiballs (dev)", bot: true },
      content: "",
      embeds: [{ description: "Invite expires <t:1700000000:R>" }],
      attachments: [{ filename: "match-7.png", url: "https://cdn.example/match-7.png" }],
      components: [
        {
          type: 1,
          components: [
            { type: 2, label: "Accept", custom_id: "mb:act:accept:7", style: 3 },
            { type: 2, label: "Cancel", custom_id: "mb:act:cancel:7", style: 2 },
          ],
        },
      ],
    };
    expect(summary(card)).toBe("Invite expires <t:1700000000:R> [1 file] [Accept | Cancel]");
  });

  it("reads a private answer's buttons, with their custom ids and which are off", () => {
    const lines = detail(fromPayload("reply", pickDurationMessage("public", null, null)));
    expect(lines).toContain("  button,Open Invite,mb:open:public:-:5,success,true");
    expect(lines).toContain("pings: nobody");
    expect(
      detail(fromPayload("reply", pickTypeMessage())).some((l) => l.startsWith("controls[3]")),
    ).toBe(true);
  });

  it("says who a thread post pings", () => {
    const post = ThreadPost.Challenged({
      by: ALICE,
      target: BOB,
      minutes: 10,
      expiresAt: 1_700_000_000_000,
    });
    expect(detail(fromPayload("post", threadMessage("7", post, NO_MARBLES)))).toContain(
      `pings: <@${BOB.discordId}>`,
    );
  });

  it("reads a form as its title and inputs", () => {
    const lines = detail(fromPayload("showModal", linkForm()));
    expect(lines[1]).toMatch(/^content: modal mb:linkform: /);
    expect(lines.some((l) => l.startsWith("  input,") && l.includes(",profile,"))).toBe(true);
  });

  it("says so when a table is empty", () => {
    expect(table("threads", ["id"], [])).toEqual(["threads: none"]);
  });
});

describe("axi's markup reader", () => {
  it("shows mentions, emojis and timestamps as a person reads them", () => {
    const m = {
      id: "1",
      content: "<:marble_165:155> **<@333>** opened a match <t:1700000000:R>",
      mentions: [{ id: "333", username: "will" }],
    };
    expect(summary(m, 200)).toBe(
      ":marble_165: **@will** opened a match (2023-11-14 22:13Z, relative)",
    );
  });

  it("says why a message shows nothing", () => {
    expect(summary({ id: "1", type: 21 })).toBe("(system: thread starter)");
    expect(summary({ id: "1", type: 0, content: "" })).toMatch(/Message Content intent/);
  });
});
