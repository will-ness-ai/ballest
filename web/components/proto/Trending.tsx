"use client";
// ============================ PROTOTYPE (grill-design, trending) ============================
// Never merged: claude/prototype-trending only. Round 2: what replaces the Workshop
// homepage's carousel, showing many Maps at once (?variant=A..E). The Steam numbers
// (plays this week, votes) are a snapshot taken 2026-10-19, joined on the server.
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PodLine } from "../workshop/Card";
import { MapImage } from "../MapImage";
import { mapHref } from "../../lib/routes";
import { ageText, fmtN } from "../../lib/rules";
import { type MapCard, type SortKey } from "../../lib/workshop";

export const VARIANTS: Array<[string, string, string]> = [
  [
    "A",
    "Top 10 chart",
    "no carousel: this week's top 10 as a ranked chart, two columns on desktop",
  ],
  ["B", "Mosaic", "no carousel: #1 big, #2-#7 smaller tiles, all pictures, all at once"],
  ["C", "Three charts", "no carousel: Trending, Top rated and Newest top 5s side by side"],
  ["D", "Big strip", "no carousel: one row of 10 large cards to swipe, a plays bar on each"],
  ["E", "Podium", "no carousel: the top 3 as a podium, #4-#10 listed under it"],
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

/* the URL, re-read whenever the picker changes it */
const subscribe = (f: () => void) => {
  addEventListener("proto-variant", f);
  return () => {
    removeEventListener("proto-variant", f);
  };
};
const emit = () => dispatchEvent(new Event("proto-variant"));
const setParams = (edit: (q: URLSearchParams) => void) => {
  const u = new URL(location.href);
  edit(u.searchParams);
  history.replaceState(history.state, "", u);
  emit();
};

export function Picker() {
  const v = useVariant();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const href = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "",
  );
  const framed = useSyncExternalStore(
    subscribe,
    () => window.top !== window || new URLSearchParams(location.search).has("framed"),
    () => true,
  );
  const go = (d: number) => {
    const i = VARIANTS.findIndex(([k]) => k === v);
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0];
    setParams((q) => {
      q.set("variant", next);
    });
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    };
    addEventListener("keydown", key);
    return () => {
      removeEventListener("keydown", key);
    };
  }, []);
  /* inside the phone frame the page draws no picker: the one outside drives it */
  if (framed) return null;
  const [path, query = ""] = href.split("?");
  const q = new URLSearchParams(query);
  const phone = q.get("view") === "phone";
  q.delete("view");
  q.set("framed", "1");
  const inner = path + "?" + q.toString();
  const setView = (to: "phone" | null) => {
    setParams((p) => {
      if (to) p.set("view", to);
      else p.delete("view");
    });
  };
  const cur = VARIANTS.find(([k]) => k === v) ?? VARIANTS[0];
  return (
    <>
      {phone ? (
        <div className="proto-frame">
          <iframe key={inner} src={inner} title="Phone view" />
        </div>
      ) : null}
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
        <div className="pp-row">
          <button
            type="button"
            aria-label="Previous variant"
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
            aria-label="Next variant"
            onClick={() => {
              go(1);
            }}
          >
            →
          </button>
        </div>
        <div className="pp-row pp-view">
          <button
            type="button"
            aria-pressed={!phone}
            onClick={() => {
              setView(null);
            }}
          >
            Desktop
          </button>
          <button
            type="button"
            aria-pressed={phone}
            onClick={() => {
              setView("phone");
            }}
          >
            Phone
          </button>
        </div>
      </div>
    </>
  );
}

const leaderOf = (m: ProtoCard) => m.top3[0];

/* one ranked row: place, picture, title and maker, the figure its list is about */
function Row({ m, n, fig, unit }: { m: ProtoCard; n: number; fig: string; unit: string }) {
  return (
    <li>
      <Link className="pt-row" href={mapHref(m.pfid)}>
        <span className="pt-n">{n}</span>
        <MapImage preview={m.preview} className="pt-th" />
        <span className="pt-tt">
          <b>{m.title}</b>
          <small>{m.creator}</small>
        </span>
        <span className="pt-w">
          {fig}
          <small>{unit}</small>
        </span>
      </Link>
    </li>
  );
}

function Head({ title, note }: { title: string; note: string }) {
  return (
    <div className="shelf-h">
      <h2>{title}</h2>
      <span className="shelf-n">{note}</span>
    </div>
  );
}

/* A: the week's top ten */
function TopTen({ proto }: { proto: Proto }) {
  return (
    <section className="pt-sec">
      <Head title="Trending this week" note="by Workshop plays in the last 7 days" />
      <ol className="pt-ten">
        {proto.trending.slice(0, 10).map((m, i) => (
          <li key={m.pfid}>
            <Link className="pt-big-row" href={mapHref(m.pfid)}>
              <span className="pt-n">{i + 1}</span>
              <MapImage preview={m.preview} className="pt-th2" />
              <span className="pt-tt">
                <b>{m.title}</b>
                <small>by {m.creator}</small>
                <span className="pt-lead">
                  <PodLine p={leaderOf(m)} i={0} />
                </span>
              </span>
              <span className="pt-w">
                {fmtN(m.week)}
                <small>plays</small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* B: pictures first, #1 the biggest */
function Mosaic({ proto }: { proto: Proto }) {
  return (
    <section className="pt-sec">
      <Head title="Trending this week" note="by Workshop plays in the last 7 days" />
      <div className="pt-mosaic">
        {proto.trending.slice(0, 7).map((m, i) => (
          <Link key={m.pfid} className="pt-tile" href={mapHref(m.pfid)}>
            <MapImage preview={m.preview} />
            <span className="pt-tile-in">
              <span className="pt-rank">#{i + 1}</span>
              <b>{m.title}</b>
              <small>
                {m.creator} &middot; {fmtN(m.week)} plays this week
              </small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* C: three lists of five */
function ThreeCharts({ proto, now }: { proto: Proto; now: number }) {
  return (
    <div className="pt-three">
      <section className="pt-col">
        <h2 className="pt-col-h">Trending</h2>
        <ol className="pt-list">
          {proto.trending.slice(0, 5).map((m, i) => (
            <Row key={m.pfid} m={m} n={i + 1} fig={fmtN(m.week)} unit="plays this week" />
          ))}
        </ol>
      </section>
      <section className="pt-col">
        <h2 className="pt-col-h">Top rated</h2>
        <ol className="pt-list">
          {proto.rated.slice(0, 5).map((m, i) => (
            <Row
              key={m.pfid}
              m={m}
              n={i + 1}
              fig={"👍 " + fmtN(m.up)}
              unit={"👎 " + fmtN(m.down)}
            />
          ))}
        </ol>
      </section>
      <section className="pt-col">
        <h2 className="pt-col-h">Newest</h2>
        <ol className="pt-list">
          {proto.newest.slice(0, 5).map((m, i) => (
            <Row key={m.pfid} m={m} n={i + 1} fig={ageText(m.created, now)} unit="published" />
          ))}
        </ol>
      </section>
    </div>
  );
}

/* D: one swipeable row of big cards */
function BigStrip({ proto }: { proto: Proto }) {
  const list = proto.trending.slice(0, 10);
  const top = list[0]?.week || 1;
  return (
    <section className="pt-sec">
      <Head title="Trending this week" note="by Workshop plays in the last 7 days" />
      <div className="pt-strip">
        {list.map((m, i) => (
          <Link key={m.pfid} className="pt-scard" href={mapHref(m.pfid)}>
            <span className="pt-scard-im">
              <MapImage preview={m.preview} />
              <span className="pt-rank">#{i + 1}</span>
            </span>
            <b>{m.title}</b>
            <small>by {m.creator}</small>
            <span className="pt-bar">
              <i style={{ inlineSize: String((m.week / top) * 100) + "%" }} />
            </span>
            <small>{fmtN(m.week)} plays this week</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* E: the top three on a podium, the next seven under it */
function Podium({ proto }: { proto: Proto }) {
  const list = proto.trending.slice(0, 10);
  return (
    <section className="pt-sec">
      <Head title="Trending this week" note="by Workshop plays in the last 7 days" />
      <div className="pt-podium">
        {list.slice(0, 3).map((m, i) => (
          <Link key={m.pfid} className="pt-pcard" data-m={i + 1} href={mapHref(m.pfid)}>
            <MapImage preview={m.preview} />
            <span className="pt-pcard-in">
              <span className="pt-rank">#{i + 1}</span>
              <b>{m.title}</b>
              <small>by {m.creator}</small>
              <span className="pt-w">
                {fmtN(m.week)}
                <small>plays this week</small>
              </span>
            </span>
          </Link>
        ))}
      </div>
      <ol className="pt-list pt-rest" start={4}>
        {list.slice(3).map((m, i) => (
          <Row key={m.pfid} m={m} n={i + 4} fig={fmtN(m.week)} unit="plays" />
        ))}
      </ol>
    </section>
  );
}

export function ProtoCarousel({ proto, now }: { proto: Proto; now: number }) {
  const v = useVariant();
  if (v === "B") return <Mosaic proto={proto} />;
  if (v === "C") return <ThreeCharts proto={proto} now={now} />;
  if (v === "D") return <BigStrip proto={proto} />;
  if (v === "E") return <Podium proto={proto} />;
  return <TopTen proto={proto} />;
}
// ========================== end PROTOTYPE (grill-design, trending) ==========================
