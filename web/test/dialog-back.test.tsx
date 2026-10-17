// @vitest-environment happy-dom
// A dialog opened with useDialog's `back` (a Map in 3D) is a step in the browser's history:
// opening it adds an entry, Back closes it and stays on the page, and closing it any other
// way takes that entry off again, so the history is as it was before it opened.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";

import { useDialog } from "../components/Modal";

/* React's act() warns outside a test renderer unless told it is one */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const [open, setOpen] = useState(false);
  const dialog = useDialog({ open, onClose: () => setOpen(false), back: true });
  return (
    <>
      <button id="open" onClick={() => setOpen(true)}>
        Open
      </button>
      <dialog {...dialog.props}>
        <form method="dialog">
          <button id="close">Close</button>
        </form>
      </dialog>
    </>
  );
}

let el: HTMLElement, root: Root;
beforeEach(() => {
  el = document.body.appendChild(document.createElement("div"));
  root = createRoot(el);
  act(() => {
    root.render(<Probe />);
  });
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  el.remove();
});

function dialog() {
  const d = el.querySelector("dialog");
  if (!d) throw new Error("no dialog");
  return d;
}
const click = (id: string) =>
  act(() => {
    [...el.querySelectorAll("button")].find((b) => b.id === id)?.click();
  });
/* history.back() lands as a popstate a moment later */
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

test("opening adds a history entry, and Back closes the dialog on the same page", async () => {
  const before = history.length;
  const at = location.href;
  click("open");
  expect(dialog().open).toBe(true);
  expect(history.length).toBe(before + 1);
  act(() => {
    history.back();
  });
  await settle();
  expect(dialog().open).toBe(false);
  expect(location.href).toBe(at);
});

test("closing it takes its entry off again, so one Back leaves the page as before", async () => {
  history.replaceState({ page: "map" }, "");
  click("open");
  expect(history.state).not.toEqual({ page: "map" });
  act(() => {
    dialog().close();
  });
  await settle();
  expect(dialog().open).toBe(false);
  expect(history.state).toEqual({ page: "map" });
});

test("reopened before its Back lands, the dialog stays open", async () => {
  /* a browser busy tearing down a big Map runs the Back a moment late */
  const back = history.back.bind(history);
  history.back = () => setTimeout(back, 5);
  try {
    history.replaceState({ page: "map" }, "");
    click("open");
    act(() => {
      dialog().close();
    });
    click("open");
    await settle();
    expect(dialog().open).toBe(true);
    act(() => {
      dialog().close();
    });
    await settle();
    expect(history.state).toEqual({ page: "map" });
  } finally {
    history.back = back;
  }
});

test("leaving the page with it open takes no step back", async () => {
  const back = history.back.bind(history);
  let backs = 0;
  history.back = () => {
    backs++;
  };
  try {
    click("open");
    act(() => {
      root.render(<></>);
    });
    await settle();
    expect(backs).toBe(0);
  } finally {
    history.back = back;
  }
});
