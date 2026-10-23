// @vitest-environment happy-dom
// The site search in the header (components/search/SearchBar.tsx): a labelled field whose
// results drop down as a list, with filter chips, the jump-to links while nothing is typed,
// ↑/↓ to move through the hits, Enter to open one, Esc and a click outside to close, and "/" or
// Ctrl/Cmd K to reach it from anywhere on the page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SearchBar } from "../components/search/SearchBar";
import type { Hit, SearchAnswer } from "../lib/search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: ({ href, ...rest }: { href: string } & React.ComponentProps<"a">) => (
    <a href={href} {...rest} />
  ),
}));

const hit = (o: Partial<Hit>): Hit => ({
  kind: "maps",
  href: "/map/1",
  title: "Solar Trials Mercury",
  meta: "by Tenpin · 3 runs",
  tag: "Map",
  img: null,
  who: null,
  score: 300,
  ...o,
});

const ANSWER: SearchAnswer = {
  q: "sol",
  hits: [
    hit({
      kind: "campaigns",
      href: "/campaign/solar-trials",
      title: "Solar Trials",
      tag: "Campaign",
    }),
    hit({ href: "/map/1", title: "Solar 1" }),
    hit({ href: "/map/2", title: "Solar 2" }),
    hit({ href: "/map/3", title: "Solar 3" }),
    hit({ href: "/map/4", title: "Solar 4" }),
  ],
  mapTotal: 12,
};

const JUMPS: Array<Hit> = [
  hit({
    kind: "dailies",
    href: "/daily",
    title: "Fresh Fields",
    meta: "Today's Daily · 2 players",
  }),
];

let el: HTMLElement, root: Root;
beforeEach(() => {
  /* happy-dom lays nothing out; the field is what a desktop shows */
  HTMLElement.prototype.checkVisibility = function (this: HTMLElement) {
    return !this.classList.contains("srch-btn");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(ANSWER))),
  );
  push.mockClear();
  el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
  act(() => {
    root.render(<SearchBar jumps={JUMPS} />);
  });
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  el.remove();
  vi.unstubAllGlobals();
});

const field = () => {
  const f = el.querySelector<HTMLInputElement>(".srch-bar input");
  if (!f) throw new Error("no field");
  return f;
};
const options = () => [...el.querySelectorAll<HTMLElement>('.srch-bar [role="option"]')];
const key = (k: string, init: KeyboardEventInit = {}, at: EventTarget = field()) =>
  act(() => {
    at.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
  });
/* `settle` false types without waiting for the answer */
async function type(text: string, settle = true) {
  await act(async () => {
    field().focus();
    /* React tracks the value it set; the native setter is what a keystroke goes through */
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
    /* the read waits for typing to settle */
    if (settle) await new Promise((r) => setTimeout(r, 200));
  });
}

describe("the site search", () => {
  test("is a labelled field that offers the jump-to links before anything is typed", () => {
    expect(field().getAttribute("aria-label")).toBe("Search the site");
    act(() => {
      field().focus();
    });
    expect(field().getAttribute("aria-expanded")).toBe("true");
    expect(options().map((o) => o.getAttribute("href"))).toEqual(["/daily"]);
    expect(el.textContent).toContain("Jump to");
  });

  test("lists the hits under chips, three of a kind under All, and links every Map", async () => {
    await type("Sol");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/search?q=sol");
    const list = el.querySelector('.srch-bar [role="listbox"]');
    expect(list?.id).toBe(field().getAttribute("aria-controls"));
    expect(options().map((o) => o.getAttribute("href"))).toEqual([
      "/campaign/solar-trials",
      "/map/1",
      "/map/2",
      "/map/3",
      "/maps?q=sol",
    ]);
    expect(el.textContent).toContain("All 12 Maps matching");
    expect(el.querySelector(".srch-bar mark")?.textContent).toBe("Sol");
    const chips = [...el.querySelectorAll<HTMLButtonElement>(".srch-chips button")];
    expect(chips.map((c) => [c.textContent, c.getAttribute("aria-pressed")])).toEqual([
      ["All", "true"],
      ["Campaigns1", "false"],
      ["Maps12", "false"],
    ]);
    act(() => {
      chips[2].click();
    });
    expect(options().map((o) => o.getAttribute("href"))).toEqual([
      "/map/1",
      "/map/2",
      "/map/3",
      "/map/4",
      "/maps?q=sol",
    ]);
  });

  test("moves through the hits with the arrows and opens one with Enter", async () => {
    await type("sol");
    key("ArrowDown");
    key("ArrowDown");
    const second = options()[1];
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(field().getAttribute("aria-activedescendant")).toBe(second.id);
    key("ArrowUp");
    key("ArrowUp");
    // round from the first to the last
    expect(options().at(-1)?.getAttribute("aria-selected")).toBe("true");
    key("ArrowDown");
    key("Enter");
    expect(push).toHaveBeenCalledWith("/campaign/solar-trials");
    expect(field().getAttribute("aria-expanded")).toBe("false");
  });

  test("Enter opens the answer to what is typed now, once it comes, not the one on screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.endsWith("=mar")
              ? { q: "mar", hits: [hit({ href: "/map/9", title: "Marble Run" })], mapTotal: 1 }
              : ANSWER,
          ),
        ),
      ),
    );
    await type("sol");
    await type("mar", false);
    // the hits on screen still answer "sol", and their marks say so
    expect(options()[0]?.getAttribute("href")).toBe("/campaign/solar-trials");
    expect(el.querySelector(".srch-bar mark")?.textContent).toBe("Sol");
    key("Enter");
    expect(push).not.toHaveBeenCalled();
    await act(() => new Promise((r) => setTimeout(r, 200)));
    expect(push).toHaveBeenCalledWith("/map/9");
  });

  test("a hit opened forgets where the breadcrumbs led back to", async () => {
    sessionStorage.setItem("ballest-ws-list", JSON.stringify({ href: "/daily", label: "Daily" }));
    await type("sol");
    key("Enter");
    expect(push).toHaveBeenCalled();
    expect(sessionStorage.getItem("ballest-ws-list")).toBeNull();
  });

  test("closes on Escape and on a click outside", async () => {
    await type("sol");
    key("Escape");
    expect(options()).toEqual([]);
    act(() => {
      field().focus();
    });
    expect(options().length).toBeGreaterThan(0);
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(options()).toEqual([]);
  });

  test("says so when nothing is found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ q: "zzz", hits: [], mapTotal: 0 }))),
    );
    await type("zzz");
    expect(el.textContent).toContain("Nothing called “zzz”");
  });

  test("the phone's sheet stays open while the header around it draws again", () => {
    HTMLElement.prototype.checkVisibility = function (this: HTMLElement) {
      return this.classList.contains("srch-btn");
    };
    key("/", {}, document.body);
    const sheet = () => el.querySelector<HTMLDialogElement>("dialog.srch-sheet");
    expect(sheet()?.open).toBe(true);
    act(() => {
      root.render(<SearchBar jumps={[...JUMPS]} />);
    });
    expect(sheet()?.open).toBe(true);
  });

  test('"/" reaches the field in a browser without checkVisibility (Safari before 17.4)', () => {
    const rects = HTMLElement.prototype.getClientRects;
    try {
      (HTMLElement.prototype as { checkVisibility?: unknown }).checkVisibility = undefined;
      HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
        return (this.classList.contains("srch-btn") ? [] : [{}]) as unknown as DOMRectList;
      };
      key("/", {}, document.body);
      expect(document.activeElement).toBe(field());
    } finally {
      HTMLElement.prototype.getClientRects = rects;
    }
  });

  test('"/" and Ctrl K put the keyboard in the field', () => {
    key("/", {}, document.body);
    expect(document.activeElement).toBe(field());
    act(() => {
      field().blur();
    });
    key("k", { ctrlKey: true }, document.body);
    expect(document.activeElement).toBe(field());
  });
});
