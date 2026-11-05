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
  const many = useParam("state") === "many";
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
    /* D: a vertical wheel over the shelf moves it sideways until it reaches an end */
    const wheel = (e: WheelEvent) => {
      if (v !== "D" || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const end = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= end)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("scroll", check);
      el.removeEventListener("wheel", wheel);
      seen.disconnect();
    };
  }, [v, many]);
  const scroll = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: glide() });
  };
  const arrows = (cls: string) => (
    <span className={cls} hidden={at.fits}>
      <button type="button" aria-label="Scroll left" disabled={at.start} onClick={() => scroll(-1)}>
        &larr;
      </button>{" "}
      <button type="button" aria-label="Scroll right" disabled={at.end} onClick={() => scroll(1)}>
        &rarr;
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
          {v === "A" ? arrows("snav proto-snav") : null}
        </span>
      </div>
      <div
        className="proto-wrap"
        data-start={at.start || undefined}
        data-end={at.end || undefined}
        data-fits={at.fits || undefined}
      >
        <div className="strip" ref={strip}>
          {cards}
        </div>
        {v === "C" ? arrows("proto-side") : null}
      </div>
      {v === "E" && !at.fits ? (
        <div className="proto-line" onPointerDown={seek} role="presentation">
          <span style={{ left: at.pos * 100 + "%", width: at.size * 100 + "%" }} />
        </div>
      ) : null}
    </section>
  );
}
