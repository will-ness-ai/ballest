"use client";
// A player shelf: a titled strip of cards that moves with the ← → buttons in its heading,
// or a swipe, and shows no scrollbar. The Workshop tab's Campaigns, World records and
// Closest to a record are each one.
import { useEffect, useRef, useState } from "react";

/* a scripted scroll glides only for those who haven't asked for less motion */
export const glide = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: no-preference)").matches ? "smooth" : "auto";

/* an arrow greys out at its end; a shelf that fits on screen has none */
export function Shelf({
  title,
  className,
  children,
}: {
  title: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ hidden: false, start: true, end: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => {
      const end = el.scrollWidth - el.clientWidth;
      setAt({ hidden: end <= 1, start: el.scrollLeft <= 1, end: el.scrollLeft >= end - 1 });
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    /* re-measure whenever the strip's size changes, not only the window's: a strip that
       was hidden, or whose cards' pictures came in late, still gets its arrows */
    const seen = new ResizeObserver(check);
    seen.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      seen.disconnect();
    };
  }, []);
  const scroll = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: glide() });
  };
  return (
    <section className={"shelf" + (className ? " " + className : "")}>
      <div className="shelf-h">
        <h2>{title}</h2>{" "}
        <span className="snav" hidden={at.hidden}>
          <button
            type="button"
            data-shelf="-1"
            aria-label="Scroll left"
            disabled={at.start}
            onClick={() => {
              scroll(-1);
            }}
          >
            &larr;
          </button>{" "}
          <button
            type="button"
            data-shelf="1"
            aria-label="Scroll right"
            disabled={at.end}
            onClick={() => {
              scroll(1);
            }}
          >
            &rarr;
          </button>
        </span>
      </div>{" "}
      <div className="strip" ref={strip}>
        {children}
      </div>
    </section>
  );
}
