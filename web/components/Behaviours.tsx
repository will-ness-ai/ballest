"use client";
// What the whole page does whatever is on it: an old #/ link opens the page it always
// opened, a tap turns a marble over, a modal dialog keeps the keyboard inside it, and a
// page whose title comes from the database keeps the tab's title right.
import { useRouter } from "next/navigation";
import { useEffect, type RefObject } from "react";

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

/* aria-modal hides the rest of the page from assistive tech, so while a dialog is open
   Escape closes it and Tab is kept inside it */
export function useModalKeys(
  open: boolean,
  box: RefObject<HTMLElement | null>,
  close: () => void,
  focusable = "button,input,a[href]",
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(focusable)];
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!box.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, [open, box, close, focusable]);
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
