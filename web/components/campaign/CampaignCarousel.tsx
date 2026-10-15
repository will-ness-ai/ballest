"use client";
// PROTOTYPE (grill-design round 4): the homepage's Campaign banners as a carousel. Never
// merged. A scroll-snap track, so a phone swipes it; the arrows step it a banner at a time.
import Link from "next/link";
import { useRef, useState } from "react";

import { MapImage } from "../MapImage";
import { Marble } from "../Marble";
import { campaignHref } from "../../lib/campaigns";
import { fmtN, personaOf } from "../../lib/rules";
import type { CampaignCard } from "./HomeEntry";

export function CampaignCarousel({ cards }: { cards: Array<CampaignCard> }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const step = (d: number) => {
    const t = track.current;
    if (!t) return;
    const w = (t.firstElementChild as HTMLElement | null)?.offsetWidth ?? t.clientWidth;
    const next = (at + d + cards.length) % cards.length;
    t.scrollTo({ left: next * (w + 12), behavior: "smooth" });
    setAt(next);
  };
  return (
    <section className="shelf ccar">
      <div className="shelf-h">
        <h2>Campaigns</h2>
        <span className="car-nav">
          <button type="button" aria-label="Previous campaign" onClick={() => step(-1)}>
            &larr;
          </button>
          <span>
            {at + 1} / {cards.length}
          </span>
          <button type="button" aria-label="Next campaign" onClick={() => step(1)}>
            &rarr;
          </button>
        </span>
      </div>
      <div
        className="ccar-track"
        ref={track}
        onScroll={(e) => {
          const t = e.currentTarget;
          const w = (t.firstElementChild as HTMLElement | null)?.offsetWidth ?? t.clientWidth;
          setAt(Math.round(t.scrollLeft / (w + 12)));
        }}
      >
        {cards.map((k) => (
          <Link key={k.c.slug} className="cban" href={campaignHref(k.c.slug)}>
            <span className="cban-pics">
              {k.previews.slice(0, 5).map((p, i) => (
                <MapImage key={i} preview={p} />
              ))}
            </span>
            <span className="cban-in">
              <span className="eyebrow">
                Campaign · {k.c.maps.length} maps · {fmtN(k.players)} players
              </span>
              <b>{k.c.title}</b>
              <span className="cban-by">by {k.c.creator}</span>
              {k.leader && (
                <span className="cban-lead">
                  <Marble who={k.leader} still /> {personaOf(k.leader)} leads with{" "}
                  {fmtN(k.leader.score)}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
