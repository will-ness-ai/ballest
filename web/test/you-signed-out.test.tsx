// @vitest-environment happy-dom
// /you signed out (spec #221): the lists' top 3 stay open, a sign-in strip sits
// on top, and in each card the row where You would be is the way to sign in, back to /you.
// A signed-in visitor never sees any of it, not even before the browser can tell.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { You } from "../hooks/me";
import { laddersOf } from "../lib/ladder";
import type { WorkshopStandingRow, WorkshopStandings } from "../lib/rows";
import { signInHref, youHref } from "../lib/routes";

let you: You = { state: "none" };
vi.mock("../hooks/me", () => ({ useYou: () => you }));

const { Ladders } = await import("../components/you/Ladders");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* five players on every list, 5 down to 1, nobody moved */
const five: Array<WorkshopStandingRow> = [0, 1, 2, 3, 4].map((i) => [
  i,
  5 - i,
  5 - i,
  i + 1,
  i + 1,
]);
const standings: WorkshopStandings = {
  readAt: "2026-10-16T12:00:00.000Z",
  since: "2026-10-14T16:00:00.000Z",
  maps: 10,
  players: ["Ann", "Bob", "Cat", "Dan", "Eve"].map((p, i): [string, string] => [String(i), p]),
  lists: { played: five, author: five, wr: five, top5: five },
};
const tops = laddersOf(standings, null);

const SIGN_IN = signInHref(youHref());
const ROW = "Sign in with Steam to see your row";

let el: HTMLElement, root: Root;
beforeEach(() => {
  /* the cards may be read again for nobody; that read never lands here */
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  el.remove();
  vi.unstubAllGlobals();
});

function draw(state: You) {
  you = state;
  act(() => {
    root.render(<Ladders tops={tops} />);
  });
}

/* the sign-in links a visitor can see and reach */
const shownSignIns = () =>
  [...el.querySelectorAll<HTMLAnchorElement>("a")].filter(
    (a) => a.getAttribute("href") === SIGN_IN && !a.closest("[aria-hidden], [inert]"),
  );

describe("signed out", () => {
  test("each list's top 3 are open to anyone", () => {
    draw({ state: "none" });
    for (const card of el.querySelectorAll("section[aria-label]")) {
      const names = [...card.querySelectorAll(".yl-nm")].map((n) => n.textContent);
      expect(names).toEqual(["Ann", "Bob", "Cat"]);
    }
  });

  test("a strip on top asks where you stand and signs in, back to /you", () => {
    draw({ state: "none" });
    const strip = el.querySelector(".ys-in");
    expect(strip?.textContent).toContain(
      "Where do you stand? Sign in with Steam and your row shows on every list.",
    );
    expect(strip?.querySelector("a")?.getAttribute("href")).toBe(SIGN_IN);
    /* it comes before the cards */
    const cards = el.querySelector(".ys-cards");
    expect(cards && strip?.compareDocumentPosition(cards)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test("in every card, the row where You would be is the sign-in, after a gap", () => {
    draw({ state: "none" });
    const cards = [...el.querySelectorAll("section[aria-label]")];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      const items = [...card.querySelectorAll(".yl-rows > li")];
      expect(items.map((li) => li.className)).toEqual([
        "yl-row",
        "yl-row",
        "yl-row",
        "yl-gap",
        "yl-sign",
      ]);
      const a = items[4].querySelector("a");
      expect(a?.textContent).toBe(ROW);
      expect(a?.getAttribute("href")).toBe(SIGN_IN);
    }
    expect(shownSignIns()).toHaveLength(5);
  });

  test("Show all still opens the whole list", () => {
    draw({ state: "none" });
    const buttons = [...el.querySelectorAll("button.yl-more")];
    expect(buttons.map((b) => b.textContent)).toEqual(Array(4).fill("Show all 5"));
  });

  test("no gap before the sign-in row when the top 3 are the whole list", () => {
    const three: Array<WorkshopStandingRow> = five.slice(0, 3);
    const small = laddersOf({ ...standings, lists: { ...standings.lists, wr: three } }, null);
    you = { state: "none" };
    act(() => {
      root.render(<Ladders tops={small} />);
    });
    const wr = el.querySelector('section[aria-label="Most world records"]');
    expect([...(wr?.querySelectorAll(".yl-rows > li") ?? [])].map((li) => li.className)).toEqual([
      "yl-row",
      "yl-row",
      "yl-row",
      "yl-sign",
    ]);
    expect(wr?.querySelector("button.yl-more")).toBeNull();
  });
});

describe("before the browser can tell who is signed in", () => {
  test("the strip and the sign-in rows hold their place, unseen and out of reach", () => {
    draw({ state: "loading", claimed: false });
    expect(shownSignIns()).toHaveLength(0);
    const held = [...el.querySelectorAll(".ys-in, .yl-sign")];
    expect(held).toHaveLength(5);
    for (const h of held) {
      expect(h.getAttribute("aria-hidden")).toBe("true");
      expect(h.hasAttribute("inert")).toBe(true);
      expect(h.hasAttribute("data-wait")).toBe(true);
    }
  });
});

describe("signed in", () => {
  test.each<[string, You]>([
    ["while a session's record is read", { state: "loading", claimed: true }],
    ["on no board yet", { state: "unknown", id: "76561198000000001" }],
  ])("%s, nothing asks to sign in", (_, state) => {
    draw(state);
    expect(el.querySelector(".ys-in")).toBeNull();
    expect(el.querySelector(".yl-sign")).toBeNull();
    expect(el.textContent).not.toContain("Sign in");
  });
});

describe("once the session is known", () => {
  test("You's cards are read without waiting for You's record", () => {
    const asked: Array<string> = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(url);
      return new Promise(() => undefined);
    });
    draw({ state: "loading", claimed: true, id: "76561198000000002" });
    expect(asked).toContain("/api/standings?ladders&player=76561198000000002");
  });
});

describe("when You's cards can't be read", () => {
  test("each card says so, and Try again reads them again", async () => {
    const asked: Array<string> = [];
    vi.stubGlobal("fetch", (url: string) => {
      asked.push(url);
      return Promise.resolve(new Response("", { status: 503 }));
    });
    draw({ state: "loading", claimed: true, id: "76561198000000003" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(el.querySelectorAll(".yl-hold")).toHaveLength(0);
    expect(el.textContent).toContain("Couldn't read your rows");
    const again = [...el.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(again).toBeDefined();
    act(() => {
      again?.click();
    });
    expect(asked.filter((u) => u.includes("player=76561198000000003"))).toHaveLength(2);
  });
});
