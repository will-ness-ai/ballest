// @vitest-environment happy-dom
// Picking your Chosen Skin on your own player page (spec #276, A5): the pencil badge on your
// marble and "Change your ball" beside Sign out open the dialog; a tap previews the ball in
// your board row, Save commits it through PUT or DELETE /api/me/skin, and anything else
// discards it. Once saved, your marble on the page and your header card draw it at once.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { You } from "../hooks/me";
import type { PlayerRecord } from "../lib/player";

const ME = "76561199000000031";
const THEM = "76561199000000032";
const GOLD = "/Game/Art/M_GoldReal.M_GoldReal";

const record = (id: string, persona: string) =>
  ({
    id,
    who: { steamId: id, persona },
    allSeasons: null,
    workshop: { mapsFinished: 3 },
  }) as unknown as PlayerRecord;

let you: You = { state: "none" };
vi.mock("../hooks/me", () => ({ useYou: () => you }));
vi.mock("next/navigation", () => ({ usePathname: () => "/player/" + ME }));

const { ChosenSkins } = await import("../components/ChosenSkins");
const { SignOut } = await import("../components/player/Me");
const { SkinPicker, YourMarble } = await import("../components/player/SkinPicker");
const { YouCard } = await import("../components/YouCard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLElement, root: Root;
let sent: Array<{ method: string; body: unknown }>;
let answer: () => Promise<Response>;
beforeEach(() => {
  sent = [];
  answer = () => Promise.resolve(Response.json({}));
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    expect(url).toBe("/api/me/skin");
    sent.push({
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return answer();
  });
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

/* a player page's head for `id`, with the header card, as You */
function draw(id: string, state: You, chosen: Record<string, string> = {}) {
  you = state;
  act(() => {
    root.render(
      <ChosenSkins value={chosen}>
        <header>
          <YouCard />
        </header>
        <div className="pid">
          <SkinPicker id={id}>
            <YourMarble who={{ steamId: id }} />
            <SignOut id={id} />
          </SkinPicker>
        </div>
      </ChosenSkins>,
    );
  });
}
const signedIn: You = { state: "ready", id: ME, rec: record(ME, "Ada") };

const dialog = () => document.querySelector("dialog");
const buttons = (scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLButtonElement>("button"),
];
const button = (text: string, scope: ParentNode = document) => {
  const b = buttons(scope).find((x) => x.textContent.trim() === text);
  if (!b) throw new Error("no button " + text);
  return b;
};
const tap = (b: HTMLElement) =>
  act(() => {
    b.click();
  });
const theDialog = () => {
  const d = dialog();
  if (!d) throw new Error("no dialog");
  return d;
};
/* the ball in the dialog called `name` */
const ball = (name: string) => button(name, theDialog());
/* what the preview row says under your name */
const previewName = () => dialog()?.querySelector(".skp-row small")?.textContent;
/* the picture a marble draws, or "hue" for the glass ball */
const drawn = (scope: Element | null) =>
  scope?.querySelector<HTMLImageElement>(".marble img.skin")?.getAttribute("src") ??
  (scope?.querySelector(".marble svg") ? "hue" : "none");
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("who sees the picker", () => {
  test.each<[string, string, You]>([
    ["signed out", ME, { state: "none" }],
    ["on someone else's page", THEM, signedIn],
    ["before the browser knows who is signed in", ME, { state: "loading", claimed: true }],
  ])("%s, there is no badge and no way to open it", (_, id, state) => {
    draw(id, state);
    expect(document.querySelector(".pid button.skp-edit")).toBeNull();
    expect(document.body.textContent).not.toContain("Change your ball");
    expect(dialog()).toBeNull();
  });

  test("on your own page, the badge on your marble and the link by Sign out both open it", () => {
    draw(ME, signedIn);
    const badge = document.querySelector<HTMLButtonElement>(".pid button.skp-edit");
    if (!badge) throw new Error("no badge");
    expect(badge.getAttribute("aria-label")).toBe("Change your ball");
    tap(badge);
    expect(dialog()?.open).toBe(true);
    act(() => {
      dialog()?.close();
    });
    expect(dialog()?.open).toBe(false);
    tap(button("Change your ball", document.querySelector(".pme") ?? document));
    expect(dialog()?.open).toBe(true);
  });
});

describe("the dialog", () => {
  test("groups every ball under Colours, Metals and Specials, named, No skin first", () => {
    draw(ME, signedIn);
    tap(button("Change your ball"));
    const d = theDialog();
    const groups = [...d.querySelectorAll("section")].map((s) => ({
      head: s.querySelector("h3")?.textContent,
      balls: buttons(s).map((b) => b.textContent),
    }));
    expect(groups.map((g) => g.head)).toEqual(["Colours", "Metals", "Specials"]);
    expect(groups[0].balls.slice(0, 3)).toEqual(["No skin", "Pink", "Light Pink"]);
    expect(groups[1].balls).toEqual(["Gold", "Silver", "Bronze", "Pearl"]);
    expect(groups.flatMap((g) => g.balls)).toHaveLength(37);
  });

  test("a tap previews the ball in your board row; Save waits until it differs", () => {
    draw(ME, signedIn, { [ME]: "/skins/DA_Skin_Cosmic1.webp" });
    tap(button("Change your ball"));
    const save = button("Save");
    expect(previewName()).toBe("Cosmic");
    expect(dialog()?.querySelector(".skp-row b")?.textContent).toBe("Ada");
    expect(ball("Cosmic").getAttribute("aria-pressed")).toBe("true");
    expect(save.disabled).toBe(true);
    tap(ball("Gold"));
    expect(previewName()).toBe("Gold");
    expect(drawn(dialog()?.querySelector(".skp-row") ?? null)).toBe(
      "/skins/DA_Skin_MedalGold.webp",
    );
    expect(save.disabled).toBe(false);
    tap(ball("Cosmic"));
    expect(save.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  test("Cancel discards the preview: nothing is sent, and it opens on your saved ball", () => {
    draw(ME, signedIn, { [ME]: "/skins/DA_Skin_Cosmic1.webp" });
    tap(button("Change your ball"));
    tap(ball("Gold"));
    tap(button("Cancel"));
    expect(dialog()?.open).toBe(false);
    expect(sent).toEqual([]);
    expect(drawn(document.querySelector(".pid"))).toBe("/skins/DA_Skin_Cosmic1.webp");
    tap(button("Change your ball"));
    expect(previewName()).toBe("Cosmic");
  });

  test("Save sends the pick, closes, and your marble and header card draw it at once", async () => {
    draw(ME, signedIn, { [ME]: "/skins/DA_Skin_Cosmic1.webp" });
    tap(button("Change your ball"));
    tap(ball("Gold"));
    tap(button("Save"));
    await settle();
    expect(sent).toEqual([{ method: "PUT", body: { skin: GOLD } }]);
    expect(dialog()?.open).toBe(false);
    expect(drawn(document.querySelector(".pid"))).toBe("/skins/DA_Skin_MedalGold.webp");
    expect(drawn(document.querySelector("header"))).toBe("/skins/DA_Skin_MedalGold.webp");
  });

  test("No skin clears the pick, and you are the hue marble again", async () => {
    draw(ME, signedIn, { [ME]: "/skins/DA_Skin_Cosmic1.webp" });
    tap(button("Change your ball"));
    tap(ball("No skin"));
    expect(previewName()).toBe("No skin");
    tap(button("Save"));
    await settle();
    expect(sent).toEqual([{ method: "DELETE", body: undefined }]);
    expect(drawn(document.querySelector(".pid"))).toBe("hue");
    expect(drawn(document.querySelector("header"))).toBe("hue");
  });

  test("a save that fails says so and changes nothing", async () => {
    answer = () => Promise.resolve(new Response("", { status: 503 }));
    draw(ME, signedIn);
    tap(button("Change your ball"));
    tap(ball("Gold"));
    tap(button("Save"));
    await settle();
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toContain("didn't save");
    expect(drawn(document.querySelector(".pid"))).toBe("hue");
    /* closing it clears the message */
    act(() => {
      dialog()?.close();
    });
    tap(button("Change your ball"));
    expect(dialog()?.querySelector("[role=alert]")).toBeNull();
  });

  test("over the hourly limit, it says to try later", async () => {
    answer = () => Promise.resolve(new Response("{}", { status: 429 }));
    draw(ME, signedIn);
    tap(button("Change your ball"));
    tap(ball("Gold"));
    tap(button("Save"));
    await settle();
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toContain("hour");
  });
});
