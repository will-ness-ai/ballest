"use client";
// ============================ PROTOTYPE (grill-design, trending) ============================
// Never merged: claude/prototype-trending only. Round 3: what the Workshop homepage's
// top 10 chart ranks by and shows on each row (?variant=A..E). The Steam numbers (plays,
// votes) are snapshots taken 2026-10-19; new players come from the live boards.
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { PodLine } from "../workshop/Card";
import { MapImage } from "../MapImage";
import { mapHref } from "../../lib/routes";
import { fmtN } from "../../lib/rules";
import { type MapCard } from "../../lib/workshop";

export const VARIANTS: Array<[string, string, string]> = [
  ["A", "Plays", "round 2's A as is: ranked by Workshop plays this week"],
  ["B", "Players", "ranked by players who set their first time this week (our boards), not plays"],
  ["C", "Movers", "ranked by plays; each row shows its move since last week (▲3, ▼2, NEW)"],
  ["D", "Daily bars", "ranked by plays; each row shows the week's plays day by day"],
  ["E", "Plays + votes", "ranked by plays lifted by rating; each row shows 👍/👎 beside its plays"],
];

/* what Steam and the boards add to a card */
export interface ProtoCard extends MapCard {
  /* Workshop plays this week, last week, and each of the last 7 days (oldest first) */
  week: number;
  prev: number;
  daily: Array<number>;
  up: number;
  down: number;
  score: number;
  /* players whose first time was seen this week, and times seen this week */
  players: number;
  runs: number;
  /* rank by plays last week, or null when it was new or unplayed */
  prevRank: number | null;
}
export interface Proto {
  trending: Array<ProtoCard>;
  players: Array<ProtoCard>;
  blend: Array<ProtoCard>;
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

function Move({ m, n }: { m: ProtoCard; n: number }) {
  if (m.prevRank == null) return <span className="pt-mv new">NEW</span>;
  const d = m.prevRank - n;
  if (d === 0) return <span className="pt-mv">=</span>;
  return d > 0 ? <span className="pt-mv up">▲{d}</span> : <span className="pt-mv down">▼{-d}</span>;
}

function Bars({ daily }: { daily: ReadonlyArray<number> }) {
  const max = Math.max(1, ...daily);
  return (
    <span className="pt-bars" aria-label="plays per day this week">
      {daily.map((d, i) => (
        <i key={i} style={{ blockSize: String(Math.max(4, (d / max) * 100)) + "%" }} />
      ))}
    </span>
  );
}

const NOTES: Record<string, string> = {
  A: "by Workshop plays in the last 7 days",
  B: "by players who set their first time in the last 7 days",
  C: "by Workshop plays in the last 7 days, against last week",
  D: "by Workshop plays in the last 7 days",
  E: "by Workshop plays in the last 7 days and votes",
};

export function ProtoCarousel({ proto }: { proto: Proto; now: number }) {
  const v = useVariant();
  const list = v === "B" ? proto.players : v === "E" ? proto.blend : proto.trending;
  return (
    <section className="pt-sec">
      <div className="shelf-h">
        <h2>Trending this week</h2>
        <span className="shelf-n">{NOTES[v] ?? NOTES.A}</span>
      </div>
      <ol className="pt-ten">
        {list.map((m, i) => (
          <li key={m.pfid}>
            <Link className="pt-big-row" href={mapHref(m.pfid)}>
              <span className="pt-n">
                {i + 1}
                {v === "C" ? <Move m={m} n={i + 1} /> : null}
              </span>
              <MapImage preview={m.preview} className="pt-th2" />
              <span className="pt-tt">
                <b>{m.title}</b>
                <small>by {m.creator}</small>
                <span className="pt-lead">
                  <PodLine p={leaderOf(m)} i={0} />
                </span>
              </span>
              {v === "D" ? <Bars daily={m.daily} /> : null}
              {v === "B" ? (
                <span className="pt-w">
                  +{fmtN(m.players)}
                  <small>new players</small>
                </span>
              ) : v === "E" ? (
                <span className="pt-w">
                  {fmtN(m.week)}
                  <small>
                    👍 {fmtN(m.up)} · 👎 {fmtN(m.down)}
                  </small>
                </span>
              ) : (
                <span className="pt-w">
                  {fmtN(m.week)}
                  <small>plays</small>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
// ========================== end PROTOTYPE (grill-design, trending) ==========================
