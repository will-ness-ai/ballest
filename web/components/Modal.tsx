"use client";
// Every modal on the site (the phone board sheet, Compare, how points work, how the boards
// refresh, the Refine panel) is a native <dialog> opened with showModal(): the browser
// keeps the keyboard inside it, hides the page behind from assistive tech and closes it
// on Escape.
import { useCallback, useEffect, useRef, type RefObject } from "react";

/* `open` says whether the dialog is shown. Everything that closes it (Escape, a close
   button, a tap on the backdrop, `open` turning false, the page being hidden or left)
   goes through dialog.close(), and its close event calls `onClose`, which sets `open`
   back to false. Focus then goes to `from` (the button that opened it: Safari doesn't
   focus a button it clicks, so the browser's own hand-back can land on the page), or else
   to whatever had it when the dialog opened. `focus` picks what opens focused when the
   dialog's first button isn't it. The <dialog> must be in the document when `open` turns
   true.

   With `back` the dialog is a step in the browser's history, for one that fills the screen
   (a Map in 3D), where Back reads as "close this": opening it adds an entry at the same URL,
   Back closes it and the page stays where it was, and closing it any other way goes back
   over that entry, so the history ends as it was before it opened. */
export function useDialog({
  open,
  onClose,
  focus,
  from,
  back = false,
}: {
  open: boolean;
  onClose: () => void;
  focus?: (d: HTMLDialogElement) => HTMLElement | null | undefined;
  from?: RefObject<HTMLElement | null>;
  back?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    if (!d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      focus?.(d)?.focus();
    }
    /* Next keeps a page it navigated away from, hidden, and runs this as it hides it: a
       dialog left open there would stay modal and leave the next page inert */
    return () => {
      if (d.open) d.close();
    };
  }, [open, focus]);
  useEffect(() => {
    if (!back || !open) return;
    /* Next's pushState copies its own state into the entry, so its router can come back to
       it; the mark tells this entry from the one under it */
    const mark = Math.random();
    let live = true;
    let pushed = false;
    let ours = true;
    const pop = () => {
      if ((history.state as { dialog?: number } | null)?.dialog === mark) return;
      ours = false;
      ref.current?.close();
    };
    const push = () => {
      if (!live) return;
      history.pushState({ dialog: mark }, "");
      pushed = true;
      addEventListener("popstate", pop);
    };
    /* reopened before the last close's Back has landed, that Back would close this one */
    if (leaving) void leaving.then(push);
    else push();
    return () => {
      live = false;
      removeEventListener("popstate", pop);
      if (!pushed || !ours) return;
      leaving = new Promise((done) =>
        addEventListener(
          "popstate",
          () => {
            leaving = null;
            done();
          },
          { once: true },
        ),
      );
      history.back();
    };
  }, [back, open]);
  /* a tap on the backdrop lands on the dialog itself, outside its box; one that starts
     inside (a drag out of the search box) is not a tap on the backdrop */
  const down = useRef(false);
  const props = {
    ref,
    onClose: (e: React.SyntheticEvent<HTMLDialogElement>) => {
      /* in development React closes and reopens it at once; the close event lands late */
      if (e.currentTarget.open) return;
      const to = from?.current ?? opener.current;
      if (to?.isConnected) to.focus();
      onClose();
    },
    onPointerDown: (e: React.PointerEvent<HTMLDialogElement>) => {
      down.current = outside(e);
    },
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => {
      if (down.current && outside(e)) e.currentTarget.close();
      down.current = false;
    },
  };
  const close = useCallback(() => ref.current?.close(), []);
  return { props, close };
}

/* the Back a closing `back` dialog sent, until the browser has done it */
let leaving: Promise<void> | null = null;

function outside(e: React.MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false;
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}
