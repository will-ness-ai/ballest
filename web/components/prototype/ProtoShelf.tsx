"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: one homepage shelf, drawn per ?variant= (see Proto.tsx's VARIANTS).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useParam, useVariant } from "./Proto";
import { glide } from "../player/Shelf";

export function ProtoShelf({
  title,
  note,
  all,
  children,
}: {
  title: string;
  note: string;
  all: string;
  children: React.ReactNode[];
}) {
  const v = useVariant() ?? "A";
  /* ?state=many repeats the cards, for a local database with only a few Maps */
  const state = useParam("state") ?? "";
  const many = state.includes("many");
  /* ?state=many,hover shows the hover-only arrows, for the round's pictures */
  const hover = state.includes("hover");
  const cards = many
    ? [0, 1, 2, 3].flatMap((k) =>
        children.map((c, i) => (
          <span key={k + "-" + i} style={{ display: "contents" }}>
            {c}
          </span>
        )),
      )
    : children;
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ fits: true, start: true, end: false, pos: 0, size: 1 });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => {
      const end = el.scrollWidth - el.clientWidth;
      setAt({
        fits: end <= 1,
        start: el.scrollLeft <= 1,
        end: el.scrollLeft >= end - 1,
        pos: el.scrollLeft / el.scrollWidth,
        size: el.clientWidth / el.scrollWidth,
      });
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const seen = new ResizeObserver(check);
    seen.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      seen.disconnect();
    };
  }, [v, many]);
  const scroll = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: glide() });
  };
  const chev = (d: number) => (
    <svg viewBox="0 0 16 16" aria-hidden="true" width="16" height="16">
      <path
        d={d < 0 ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const arrows = (cls: string, glyph: (d: number) => React.ReactNode = chev) => (
    <span className={cls} hidden={at.fits}>
      <button type="button" aria-label="Scroll left" disabled={at.start} onClick={() => scroll(-1)}>
        {glyph(-1)}
      </button>{" "}
      <button type="button" aria-label="Scroll right" disabled={at.end} onClick={() => scroll(1)}>
        {glyph(1)}
      </button>
    </span>
  );
  /* E: click or drag along the line to move there */
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = strip.current;
    const line = e.currentTarget;
    if (!el) return;
    line.setPointerCapture(e.pointerId);
    const to = (x: number) => {
      const box = line.getBoundingClientRect();
      const f = (x - box.left) / box.width - at.size / 2;
      el.scrollLeft = f * el.scrollWidth;
    };
    to(e.clientX);
    const move = (m: PointerEvent) => to(m.clientX);
    const up = () => {
      line.removeEventListener("pointermove", move);
      line.removeEventListener("pointerup", up);
    };
    line.addEventListener("pointermove", move);
    line.addEventListener("pointerup", up);
  };
  return (
    <section className={"shelf proto-sh v-" + v}>
      <div className="shelf-h">
        <h2>{title}</h2>
        <span className="shelf-n">
          {note} &middot; <Link href={all}>See all</Link>
          {v === "E" ? arrows("snav proto-snav", (d) => (d < 0 ? "\u2190" : "\u2192")) : null}
        </span>
      </div>
      <div
        className="proto-wrap"
        data-start={at.start || undefined}
        data-end={at.end || undefined}
        data-fits={at.fits || undefined}
        data-hover={hover || undefined}
      >
        <div className="strip" ref={strip}>
          {cards}
        </div>
        {v === "C" ? arrows("proto-zone") : null}
        {v === "D" ? arrows("proto-chip") : null}
      </div>
      {!at.fits ? (
        <div className="proto-lrow">
          {v === "B" ? arrows("proto-larr") : null}
          <div className="proto-line" onPointerDown={seek} role="presentation">
            <span style={{ left: at.pos * 100 + "%", width: at.size * 100 + "%" }} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
