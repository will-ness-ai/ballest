// @vitest-environment happy-dom
// The control kit (components/Controls.tsx): every choice inside a page is a pill in a named
// group, the lit one marked for a screen reader (the current page on a link, pressed on a
// button), and every in-page search box is one labelled search field.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";

import { PillButton, PillLink, Pills, SearchBox } from "../components/Controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLElement, root: Root;
beforeEach(() => {
  el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  el.remove();
});
const draw = (node: React.ReactNode) => {
  act(() => {
    root.render(node);
  });
};

test("a row of link pills is a named navigation with only the lit one the current page", () => {
  draw(
    <Pills label="Sort by" nav>
      <PillLink href="/board/x" on={false}>
        Points
      </PillLink>
      <PillLink href="/board/x/podiums" on>
        Podiums
      </PillLink>
    </Pills>,
  );
  const nav = el.querySelector("nav");
  expect(nav?.getAttribute("aria-label")).toBe("Sort by");
  const links = [...el.querySelectorAll("a")].map((a) => [
    a.textContent,
    a.getAttribute("href"),
    a.getAttribute("aria-current"),
  ]);
  expect(links).toEqual([
    ["Points", "/board/x", null],
    ["Podiums", "/board/x/podiums", "page"],
  ]);
});

test("a row of button pills is a named group, each saying whether it is pressed", () => {
  const picked: Array<string> = [];
  draw(
    <Pills label="Sort">
      {["Popular", "Newest"].map((s) => (
        <PillButton key={s} on={s === "Popular"} onClick={() => picked.push(s)}>
          {s}
        </PillButton>
      ))}
    </Pills>,
  );
  const group = el.querySelector("[role=group]");
  expect(group?.getAttribute("aria-label")).toBe("Sort");
  const buttons = [...el.querySelectorAll("button")];
  expect(buttons.map((b) => [b.textContent, b.type, b.getAttribute("aria-pressed")])).toEqual([
    ["Popular", "button", "true"],
    ["Newest", "button", "false"],
  ]);
  act(() => {
    buttons[1]?.click();
  });
  expect(picked).toEqual(["Newest"]);
});

test("a search box is one labelled search field that hands its typing on", () => {
  const typed: Array<string> = [];
  draw(
    <SearchBox
      id="q"
      placeholder="Find a player"
      aria-label="Find a player"
      onInput={(e) => typed.push(e.currentTarget.value)}
    />,
  );
  const inputs = el.querySelectorAll("input");
  expect(inputs).toHaveLength(1);
  const input = inputs[0];
  expect([input.type, input.id, input.getAttribute("aria-label")]).toEqual([
    "search",
    "q",
    "Find a player",
  ]);
  /* the magnifier is drawing only */
  expect(el.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  act(() => {
    input.value = "will";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(typed).toEqual(["will"]);
});
