"use client";
// The Workshop homepage's Campaigns, under its main carousel: a scroll-snap track of
// banners (CampaignBanner, drawn on the server and passed in), so a phone swipes it, with
// the main carousel's arrows and counter to step it a banner at a time, and See all for
// /campaigns. A phone shows one banner with the next peeking in, a desktop two. The counter
// names the banners in view; the arrows wrap round, as the main carousel's do, and hide
// when every banner is in view.
import Link from "next/link";
import { Children, useEffect, useRef, useState } from "react";

import { campaignsHref } from "../../lib/routes";

/* the banners in view, from the track's scroll: the first (0-based) and how many */
function inView(t: HTMLElement) {
  const first = t.firstElementChild as HTMLElement | null;
  if (!first) return { at: 0, per: 1 };
  const stride = first.offsetWidth + (parseFloat(getComputedStyle(t).columnGap) || 0);
  const per = Math.max(1, Math.round((t.clientWidth + stride - first.offsetWidth) / stride));
  const end = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2;
  const at = end ? t.children.length - per : Math.round(t.scrollLeft / stride);
  return { at: Math.max(0, at), per };
}

export function CampaignCarousel({ children }: { children: React.ReactNode }) {
  const n = Children.count(children);
  const track = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ at: 0, per: 1 });
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    const measure = () => {
      setView(inView(t));
    };
    measure();
    /* a resize changes how many fit; the scroll which are in view */
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    t.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      t.removeEventListener("scroll", measure);
    };
  }, []);
  if (!n) return null;
  const step = (d: number) => {
    const t = track.current;
    if (!t) return;
    const { at, per } = inView(t);
    const to = d > 0 ? (at + per >= n ? 0 : at + 1) : at === 0 ? n - per : at - 1;
    const banner = t.children[to] as HTMLElement | undefined;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    t.scrollTo({
      /* the track is positioned, so a banner's offset is from its start */
      left: banner ? banner.offsetLeft : 0,
      behavior: still ? "instant" : "smooth",
    });
  };
  const last = Math.min(n, view.at + view.per);
  return (
    <section className="shelf ccar" aria-label="Campaigns">
      <div className="shelf-h">
        <h2>Campaigns</h2>
        <span className="ccar-h">
          <span className="shelf-n">
            <Link href={campaignsHref()}>See all</Link>
          </span>
          {view.per < n && (
            <span className="car-nav">
              <button
                type="button"
                aria-label="Previous campaign"
                onClick={() => {
                  step(-1);
                }}
              >
                &larr;
              </button>
              <span>
                {last - view.at > 1 ? `${String(view.at + 1)}–${String(last)}` : view.at + 1} / {n}
              </span>
              <button
                type="button"
                aria-label="Next campaign"
                onClick={() => {
                  step(1);
                }}
              >
                &rarr;
              </button>
            </span>
          )}
        </span>
      </div>
      <div className="ccar-track" ref={track}>
        {children}
      </div>
    </section>
  );
}
