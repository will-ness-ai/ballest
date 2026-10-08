"use client";
// What the whole page does whatever is on it: an old #/ link opens the page it always
// opened, a tap turns a marble over, a modal opens as a native dialog, and a
// page whose title comes from the database keeps the tab's title right.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { legacyPath } from "../lib/routes";
import { pageTitle } from "../lib/rules";

/* the single-page site's links (#/player/<id>, #/board/<name>, ...) live on in Discord
   and bookmarks; each lands on its path */
export function LegacyHash() {
  const router = useRouter();
  useEffect(() => {
    const go = () => {
      const to = legacyPath(location.hash);
      if (to) router.replace(to);
    };
    go();
    addEventListener("hashchange", go);
    return () => {
      removeEventListener("hashchange", go);
    };
  }, [router]);
  return null;
}

/* a phone has no hover, so tapping a marble turns it over, top three included */
export function MarbleFlip() {
  useEffect(() => {
    const flip = (e: MouseEvent) => {
      const m = (e.target as Element | null)?.closest(".marble");
      if (m?.tagName !== "BUTTON") return;
      const wasOn = m.classList.contains("on");
      document.querySelectorAll(".marble.on").forEach((n) => {
        n.classList.remove("on");
      });
      if (!wasOn) m.classList.add("on");
    };
    document.addEventListener("click", flip);
    return () => {
      document.removeEventListener("click", flip);
    };
  }, []);
  return null;
}

/* a modal is a native <dialog>: showModal() keeps the keyboard inside it, hides the page
   from assistive tech and hands focus back when it closes; Escape closes it. Everything
   that closes it (Escape, the close button, a tap on the backdrop) goes through
   dialog.close(), and its close event tells the owner. `focus` picks what opens focused
   when the dialog's first button isn't it. */
export function useDialog(
  open: boolean,
  onClose: () => void,
  focus?: (d: HTMLDialogElement) => HTMLElement | null | undefined,
) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      focus?.(d)?.focus();
    } else if (!open && d.open) d.close();
  }, [open, focus]);
  /* a tap on the backdrop lands on the dialog itself, outside its box; one that starts
     inside (a drag out of the search box) is not a tap on the backdrop */
  const down = useRef(false);
  const props = {
    ref,
    /* the browser hands focus back only if it was still inside; a tap on the backdrop
       has already dropped it on the page */
    onClose: () => {
      const at = document.activeElement;
      if ((!at || at === document.body) && opener.current?.isConnected) opener.current.focus();
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

/* A page whose title is read from the database (a player, a Map) streams its metadata
   when it is served from the App Shell, and Next then leaves that first title in place
   on every later visit to the same route (Next 16.3: /player/A, then /player/B, still
   reads A). The page sets the title itself as well, so the tab always names it. */
export function DocTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
  return null;
}
