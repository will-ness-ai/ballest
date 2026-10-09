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
   true. */
export function useDialog({
  open,
  onClose,
  focus,
  from,
}: {
  open: boolean;
  onClose: () => void;
  focus?: (d: HTMLDialogElement) => HTMLElement | null | undefined;
  from?: RefObject<HTMLElement | null>;
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

function outside(e: React.MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false;
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}
