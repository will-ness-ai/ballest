"use client";
// ============================ PROTOTYPE (grill-design, trending) ============================
// Never merged: claude/prototype-trending only. Round 1: what the Workshop homepage's
// carousel shows, now that Steam gives us plays this week and votes (?variant=A..E). The
// Steam numbers are a snapshot taken 2026-10-19 (steam-snapshot.json), joined on the server.
import Link from "next/link";
import { useEffect, useState } from "react";

import { CreatorLink, PodLine } from "../workshop/Card";
import { MapImage } from "../MapImage";
import { mapHref } from "../../lib/routes";
import { ageText, fmtN, fmtTime } from "../../lib/rules";
import { recordOf, whyOf, type MapCard, type SortKey } from "../../lib/workshop";

export const VARIANTS: Array<[string, string, string]> = [
  ["A", "Swap two picks", "same carousel; Most played -> Trending, Most runs -> Top rated"],
  ["B", "Trending top 5", "every slide is this week's top 5 by plays, ranked #1-#5"],
  ["C", "Hero + chart", "one big Trending #1 beside a this-week chart of 2-6; tap to swap"],
  ["D", "Tabs", "Trending / Top rated / Newest tabs, each cycling its own top 5"],
  ["E", "Today's mix", "5 picks drawn daily from a hot score (plays this week x rating)"],
];

/* what Steam adds to a card, from the snapshot */
export interface ProtoCard extends MapCard {
  week: number;
  up: number;
  down: number;
  score: number;
}
export interface Proto {
  /* today's picks: Newest, Barely played and Tightest top three, as the server chose them */
  others: Array<{ label: string; sort: SortKey; m: ProtoCard }>;
  trending: Array<ProtoCard>;
  rated: Array<ProtoCard>;
  newest: Array<ProtoCard>;
  hot: Array<ProtoCard>;
}

interface Slide {
  label: string;
  why: string;
  m: ProtoCard;
}

export function useVariant() {
  const [v, setV] = useState("A");
  useEffect(() => {
    const read = () => {
      setV(new URLSearchParams(location.search).get("variant") ?? "A");
    };
    read();
    addEventListener("proto-variant", read);
    return () => {
      removeEventListener("proto-variant", read);
    };
  }, []);
  return v;
}

export function Picker() {
  const v = useVariant();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const go = (d: number) => {
    const i = VARIANTS.findIndex(([k]) => k === v);
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0];
    const u = new URL(location.href);
    u.searchParams.set("variant", next);
    history.replaceState(history.state, "", u);
    dispatchEvent(new Event("proto-variant"));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", key);
    return () => {
      removeEventListener("keydown", key);
    };
  });
  const cur = VARIANTS.find(([k]) => k === v) ?? VARIANTS[0];
  return (
    <div
      className="proto-pick"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const r = e.currentTarget.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        const move = (m: PointerEvent) => {
          setPos({ x: m.clientX - dx, y: m.clientY - dy });
        };
        const up = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      }}
    >
      <button
        type="button"
        onClick={() => {
          go(-1);
        }}
      >
        ←
      </button>
      <span title={cur[2]}>
        <b>
          {cur[0]} · {cur[1]}
        </b>
        <small>{cur[2]}</small>
      </span>
      <button
        type="button"
        onClick={() => {
          go(1);
        }}
      >
        →
      </button>
    </div>
  );
}

const weekWhy = (m: ProtoCard) => fmtN(m.week) + " plays this week";
const votesWhy = (m: ProtoCard) => `👍 ${fmtN(m.up)} · 👎 ${fmtN(m.down)}`;

/* the production carousel, taking any slides */
function Carousel({ slides, extra }: { slides: ReadonlyArray<Slide>; extra?: React.ReactNode }) {
  const [slide, setSlide] = useState(0);
  if (!slides.length) return null;
  const step = (d: number) => {
    setSlide((s) => (s + d + slides.length) % slides.length);
  };
  const p = slides[slide % slides.length],
    m = p.m;
  return (
    <div
      className="car"
      onAnimationEnd={(e) => {
        if (e.animationName === "carfill") step(1);
      }}
    >
      <div className="car-pic">
        {slides.map((x, i) => (
          <MapImage
            key={x.m.pfid}
            preview={x.m.preview}
            className={"sl" + (i === slide % slides.length ? " on" : "")}
          />
        ))}
      </div>
      <div>
        <div className="car-in" key={slide}>
          {extra}
          <span className="eyebrow">
            {p.label} <span className="why">&middot; {p.why}</span>
          </span>
          <h2 className="car-t">{m.title}</h2>
          <span className="car-by">
            by <CreatorLink m={m} />
          </span>
          <div className="car-stats">
            <span>
              <b>{fmtN(m.entryCount)}</b>runs
            </span>
            <span>
              <b>{fmtTime(recordOf(m))}</b>record
            </span>
            <span>
              <b>{fmtN(m.sessions)}</b>plays
            </span>
          </div>
          <div className="car-pod">
            {m.top3.map((x, i) => (
              <PodLine key={i} p={x} i={i} />
            ))}
          </div>
          <div className="car-acts">
            <Link className="go" href={mapHref(m.pfid)}>
              See the leaderboard
            </Link>
            <span className="car-nav">
              <button
                type="button"
                aria-label="Previous pick"
                onClick={() => {
                  step(-1);
                }}
              >
                &larr;
              </button>
              <span>
                {(slide % slides.length) + 1} / {slides.length}
              </span>
              <button
                type="button"
                aria-label="Next pick"
                onClick={() => {
                  step(1);
                }}
              >
                &rarr;
              </button>
            </span>
          </div>
          <div className="car-line">
            <i className="prog"></i>
          </div>
        </div>
      </div>
    </div>
  );
}

function othersSlides(proto: Proto, now: number): Array<Slide> {
  return proto.others.map((o) => ({ label: o.label, m: o.m, why: whyOf(o, now) }));
}

/* A: today's carousel with two picks swapped */
function SwapTwo({ proto, now }: { proto: Proto; now: number }) {
  const used = new Set(proto.others.map((o) => o.m.pfid));
  const t = proto.trending.find((m) => !used.has(m.pfid));
  if (t) used.add(t.pfid);
  const r = proto.rated.find((m) => !used.has(m.pfid));
  const [newest, ...rest] = othersSlides(proto, now);
  const slides: Array<Slide> = [];
  if (t) slides.push({ label: "Trending", why: weekWhy(t), m: t });
  slides.push(newest);
  if (r) slides.push({ label: "Top rated", why: votesWhy(r), m: r });
  slides.push(...rest);
  return <Carousel slides={slides} />;
}

/* B: the week's top five */
function TopFive({ proto }: { proto: Proto }) {
  return (
    <Carousel
      slides={proto.trending.slice(0, 5).map((m, i) => ({
        label: `#${String(i + 1)} trending`,
        why: weekWhy(m),
        m,
      }))}
    />
  );
}

/* C: one hero, and the rest of the week's chart beside it */
function HeroChart({ proto }: { proto: Proto }) {
  const [on, setOn] = useState(0);
  const list = proto.trending.slice(0, 6);
  const m = list[on];
  return (
    <div className="pt-hero">
      <Link className="pt-big" href={mapHref(m.pfid)}>
        <MapImage preview={m.preview} className="pt-big-im" />
        <span className="pt-big-in">
          <span className="eyebrow">
            #{on + 1} trending <span className="why">&middot; {weekWhy(m)}</span>
          </span>
          <b className="car-t">{m.title}</b>
          <span className="car-by">by {m.creator}</span>
          <span className="pt-big-pod">
            {m.top3.map((x, i) => (
              <PodLine key={i} p={x} i={i} />
            ))}
          </span>
        </span>
      </Link>
      <ol className="pt-chart">
        <li className="pt-chart-h">This week</li>
        {list.map((x, i) => (
          <li key={x.pfid}>
            <button
              type="button"
              className={"pt-row" + (i === on ? " on" : "")}
              onClick={() => {
                setOn(i);
              }}
            >
              <span className="pt-n">{i + 1}</span>
              <MapImage preview={x.preview} className="pt-th" />
              <span className="pt-tt">
                <b>{x.title}</b>
                <small>{x.creator}</small>
              </span>
              <span className="pt-w">
                {fmtN(x.week)}
                <small>plays</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* D: one carousel per list, behind tabs */
function Tabs({ proto, now }: { proto: Proto; now: number }) {
  const [tab, setTab] = useState(0);
  const tabs: Array<[string, Array<Slide>]> = [
    [
      "Trending",
      proto.trending.slice(0, 5).map((m, i) => ({
        label: `#${String(i + 1)} this week`,
        why: weekWhy(m),
        m,
      })),
    ],
    [
      "Top rated",
      proto.rated.slice(0, 5).map((m, i) => ({
        label: `#${String(i + 1)} top rated`,
        why: votesWhy(m),
        m,
      })),
    ],
    [
      "Newest",
      proto.newest.slice(0, 5).map((m) => ({
        label: "New",
        why: "published " + ageText(m.created, now),
        m,
      })),
    ],
  ];
  return (
    <>
      <div className="pt-tabs" role="tablist">
        {tabs.map(([name], i) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={i === tab}
            className={i === tab ? "on" : ""}
            onClick={() => {
              setTab(i);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <Carousel key={tab} slides={tabs[tab][1]} />
    </>
  );
}

/* E: five drawn each day (UTC) from the hottest fifteen, the hotter the likelier */
function draw(hot: ReadonlyArray<ProtoCard>, day: number): Array<ProtoCard> {
  let t = day >>> 0;
  const rand = () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...hot];
  const out: Array<ProtoCard> = [];
  while (out.length < 5 && pool.length) {
    const i = Math.floor(rand() * Math.min(pool.length, 8));
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function TodaysMix({ proto, now }: { proto: Proto; now: number }) {
  const slides = draw(proto.hot, Math.floor(now / 86400000)).map((m) => ({
    label: "Today's pick",
    why: m.score >= 0.58 ? votesWhy(m) + " · " + weekWhy(m) : weekWhy(m),
    m,
  }));
  return <Carousel slides={slides} />;
}

export function ProtoCarousel({ proto, now }: { proto: Proto; now: number }) {
  const v = useVariant();
  if (v === "B") return <TopFive proto={proto} />;
  if (v === "C") return <HeroChart proto={proto} />;
  if (v === "D") return <Tabs proto={proto} now={now} />;
  if (v === "E") return <TodaysMix proto={proto} now={now} />;
  return <SwapTwo proto={proto} now={now} />;
}
// ========================== end PROTOTYPE (grill-design, trending) ==========================
