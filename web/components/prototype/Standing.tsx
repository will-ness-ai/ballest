"use client";
// ============================================================================================
// PROTOTYPE (grill-design, claude/prototype-standing): never merged. Round 1 asks the page's
// overall shape: five layouts of "where you stand on the Daily Report's four lists", with a
// picker (bottom right, ←/→) and states (signed out, a mid-table player, a leader, no times).
// ============================================================================================
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { SteamMark } from "../SteamMark";
import type { ProtoLists, Stat } from "../../db/prototype-standing";
import { useYou } from "../../hooks/me";
import { signInHref } from "../../lib/routes";
import { fmtN, ord, plural, relTime } from "../../lib/rules";

const STATS: Array<Stat> = ["played", "author", "wr", "top5"];
const THEN: Partial<Record<Stat, Stat>> = { wr: "top5", top5: "wr" };
const TITLE: Record<Stat, string> = {
  played: "Most Maps played",
  author: "Most Author Medals",
  wr: "Most world records",
  top5: "Most top 5s",
};
const NOUN: Record<Stat, [string, string]> = {
  played: ["Map", "Maps"],
  author: ["Author Medal", "Author Medals"],
  wr: ["world record", "world records"],
  top5: ["top 5", "top 5s"],
};
const SHORT: Record<Stat, string> = {
  played: "Maps played",
  author: "Author Medals",
  wr: "World records",
  top5: "Top 5s",
};

interface Who {
  steamId: string;
  persona: string;
}
interface Row extends Who {
  n: number;
  place: number;
}
interface ListView {
  stat: Stat;
  ranked: Array<Row>;
  me: Row | null;
  before: number | null;
  gain: number;
  above: Row | null;
  below: Row | null;
}

const VARIANTS = [
  ["A", "Four cards"],
  ["B", "Ladders"],
  ["C", "One table"],
  ["D", "The report's image"],
  ["E", "Headline and chase"],
] as const;
type VariantKey = (typeof VARIANTS)[number][0];
const STATES = [
  ["auto", "Signed in (real, else sample)"],
  ["mid", "Mid-table"],
  ["top", "A leader"],
  ["new", "No Workshop times"],
  ["out", "Signed out"],
] as const;
type StateKey = (typeof STATES)[number][0];

function lists(data: ProtoLists) {
  const num = (r: ProtoLists["rows"][number], i: number) => r[i] as number;
  const rank = (offset: number) => (stat: Stat) => {
    const k = STATS.indexOf(stat);
    const t = THEN[stat];
    const kt = t ? STATS.indexOf(t) : -1;
    return data.rows
      .filter((r) => num(r, offset + k) > 0)
      .sort(
        (a, b) =>
          num(b, offset + k) - num(a, offset + k) ||
          (kt >= 0 ? num(b, offset + kt) - num(a, offset + kt) : 0) ||
          (a[0] < b[0] ? -1 : 1),
      )
      .map((r, i): Row => ({ steamId: r[0], persona: r[1], n: num(r, offset + k), place: i + 1 }));
  };
  const now = Object.fromEntries(STATS.map((s) => [s, rank(2)(s)])) as Record<Stat, Array<Row>>;
  const then = Object.fromEntries(STATS.map((s) => [s, rank(6)(s)])) as Record<Stat, Array<Row>>;
  return { now, then };
}

function viewFor(all: ReturnType<typeof lists>, id: string): Array<ListView> {
  return STATS.map((stat) => {
    const ranked = all.now[stat];
    const i = ranked.findIndex((r) => r.steamId === id);
    const me = i >= 0 ? ranked[i] : null;
    const b = all.then[stat].find((r) => r.steamId === id) ?? null;
    return {
      stat,
      ranked,
      me,
      before: b?.place ?? null,
      gain: (me?.n ?? 0) - (b?.n ?? 0),
      above: i > 0 ? ranked[i - 1] : i < 0 ? (ranked.at(-1) ?? null) : null,
      below: i >= 0 ? (ranked[i + 1] ?? null) : null,
    };
  });
}

/* how many more of the stat pass the player above */
const toPass = (v: ListView) => (v.above ? v.above.n - (v.me?.n ?? 0) + 1 : 0);
const moveOf = (v: ListView) => (v.me && v.before ? v.before - v.me.place : null);

function Move({ v }: { v: ListView }) {
  const m = moveOf(v);
  if (!v.me) return null;
  if (v.before === null) return <span className="pt-move up">new</span>;
  if (m === 0) return <span className="pt-move">–</span>;
  return (
    <span className={m && m > 0 ? "pt-move up" : "pt-move down"}>
      {m && m > 0 ? "▲" : "▼"}
      {Math.abs(m ?? 0)}
    </span>
  );
}

function chaseLine(v: ListView) {
  const [one, many] = NOUN[v.stat];
  if (!v.me) return v.ranked.length ? `1 ${one} puts you on the list` : "Nobody is on it yet";
  if (!v.above) return v.below ? `You lead by ${plural(v.me.n - v.below.n, one, many)}` : "You lead";
  const n = toPass(v);
  return `${plural(n, one, many)} more to pass ${v.above.persona}`;
}

// ------------------------------------------------------------------ A · Four cards
function Cards({ views }: { views: Array<ListView> }) {
  return (
    <div className="pta-grid">
      {views.map((v) => (
        <section key={v.stat} className="pta-card">
          <h2 className="pt-h">{TITLE[v.stat]}</h2>
          <div className="pta-place">
            <b>{v.me ? ord(v.me.place) : "–"}</b>
            <Move v={v} />
          </div>
          <p className="pta-of">
            {v.me ? `of ${fmtN(v.ranked.length)} · ${plural(v.me.n, ...NOUN[v.stat])}` : "Not on this list yet"}
            {v.gain > 0 && <span className="pt-gain"> +{v.gain} today</span>}
          </p>
          <p className="pta-chase">{chaseLine(v)}</p>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ B · Ladders
function ladderRows(v: ListView): Array<Row | "gap"> {
  const r = v.ranked;
  if (!v.me) return [...r.slice(0, 3), "gap"];
  const i = v.me.place - 1;
  if (i <= 5) return r.slice(0, Math.max(5, i + 2));
  return [...r.slice(0, 3), "gap", ...r.slice(i - 2, i + 2)];
}
function Ladders({ views, id }: { views: Array<ListView>; id: string }) {
  return (
    <div className="ptb-grid">
      {views.map((v) => (
        <section key={v.stat} className="ptb-card">
          <h2 className="pt-h">
            {TITLE[v.stat]} <Move v={v} />
          </h2>
          <ol className="ptb-rows">
            {ladderRows(v).map((row, k) =>
              row === "gap" ? (
                <li key={"g" + k} className="ptb-gap">
                  ⋯
                </li>
              ) : (
                <li key={row.steamId} className={row.steamId === id ? "ptb-row me" : "ptb-row"}>
                  <span className="ptb-pl">{row.place}</span>
                  <Marble who={row} still />
                  <span className="ptb-name">
                    <PlayerLink id={row.steamId} text={row.persona} />
                  </span>
                  <b className="ptb-n">{fmtN(row.n)}</b>
                </li>
              ),
            )}
            {!v.me && <li className="ptb-row me ghost">You · not on this list yet</li>}
          </ol>
          <p className="pt-foot">{chaseLine(v)}</p>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ C · One table
function Table({ views }: { views: Array<ListView> }) {
  return (
    <table className="ptc-table">
      <thead>
        <tr>
          <th>List</th>
          <th>Place</th>
          <th>You</th>
          <th className="ptc-day">Today</th>
          <th className="ptc-next">Next up</th>
        </tr>
      </thead>
      <tbody>
        {views.map((v) => (
          <tr key={v.stat}>
            <th scope="row">{SHORT[v.stat]}</th>
            <td>
              <b>{v.me ? ord(v.me.place) : "–"}</b>
              <small> / {fmtN(v.ranked.length)}</small>
            </td>
            <td>{fmtN(v.me?.n ?? 0)}</td>
            <td className="ptc-day">
              <Move v={v} />
              {v.gain > 0 && <span className="pt-gain"> +{v.gain}</span>}
            </td>
            <td className="ptc-next">{chaseLine(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ D · The report's image
function Image({ views, id, data }: { views: Array<ListView>; id: string; data: ProtoLists }) {
  return (
    <div className="ptd-sheet">
      <header className="ptd-head">
        <b>Workshop standings</b>
        <span>
          {fmtN(data.maps)} Workshop Maps · {fmtN(data.rows.length)} players
        </span>
      </header>
      <div className="ptd-grid">
        {views.map((v) => (
          <section key={v.stat} className="ptd-board">
            <h2 className="pt-h">{TITLE[v.stat]}</h2>
            <ol>
              {v.ranked.slice(0, 10).map((r) => (
                <li key={r.steamId} className={r.steamId === id ? "me" : undefined}>
                  <span className="ptd-pl">{r.place}</span>
                  <span className="ptd-name">{r.persona}</span>
                  <b>{fmtN(r.n)}</b>
                </li>
              ))}
              {(!v.me || v.me.place > 10) && (
                <li className="me pinned">
                  <span className="ptd-pl">{v.me ? v.me.place : "–"}</span>
                  <span className="ptd-name">You</span>
                  <b>{fmtN(v.me?.n ?? 0)}</b>
                </li>
              )}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ E · Headline and chase
function Chase({ views }: { views: Array<ListView> }) {
  const on = views.filter((v) => v.me);
  const best = [...on].sort((a, b) => (a.me?.place ?? 0) - (b.me?.place ?? 0))[0];
  const rest = on.filter((v) => v !== best);
  const chase = [...views].filter((v) => v.above).sort((a, b) => toPass(a) - toPass(b));
  return (
    <div className="pte">
      {best?.me ? (
        <p className="pte-hero">
          You&apos;re <b>{ord(best.me.place)}</b> in {TITLE[best.stat]}
          {rest.length > 0 && (
            <small>
              and{" "}
              {rest
                .map((v) => `${ord(v.me?.place ?? 0)} in ${SHORT[v.stat].toLowerCase()}`)
                .join(", ")}
            </small>
          )}
        </p>
      ) : (
        <p className="pte-hero">You&apos;re not on any list yet</p>
      )}
      <h2 className="pt-h">Closest to climb</h2>
      <ol className="pte-list">
        {chase.map((v) => (
          <li key={v.stat}>
            <span className="pte-n">+{toPass(v)}</span>
            <span>
              <b>{NOUN[v.stat][toPass(v) === 1 ? 0 : 1]}</b> to pass {v.above?.persona} for{" "}
              {ord(v.above?.place ?? 0)} in {SHORT[v.stat].toLowerCase()}
            </span>
          </li>
        ))}
        {views
          .filter((v) => v.me && !v.above)
          .map((v) => (
            <li key={v.stat} className="lead">
              <span className="pte-n">1st</span>
              <span>{chaseLine(v)} in {SHORT[v.stat].toLowerCase()}</span>
            </li>
          ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ the page
export function Standing({ data }: { data: ProtoLists }) {
  const params = useSearchParams();
  const [variant, setVariant] = useState<VariantKey>(
    (VARIANTS.find((v) => v[0] === params.get("variant"))?.[0] ?? "A") as VariantKey,
  );
  const [state, setState] = useState<StateKey>(
    (STATES.find((s) => s[0] === params.get("state"))?.[0] ?? "auto") as StateKey,
  );
  const you = useYou();
  const all = useMemo(() => lists(data), [data]);

  const sampleMid = all.now.played[11]?.steamId ?? data.rows[0]?.[0] ?? "";
  const sampleTop = all.now.wr[0]?.steamId ?? sampleMid;
  const as = params.get("as");
  const id =
    as ??
    (state === "mid"
      ? sampleMid
      : state === "top"
        ? sampleTop
        : state === "new"
          ? "76561190000000000"
          : you.state === "ready" || you.state === "unknown"
            ? you.id
            : sampleMid);
  const signedOut = state === "out";
  const persona = data.rows.find((r) => r[0] === id)?.[1] ?? "You";
  const views = viewFor(all, id);

  const set = useCallback((k: "variant" | "state", v: string) => {
    const url = new URL(location.href);
    url.searchParams.set(k, v);
    history.replaceState(history.state, "", url);
  }, []);
  const step = useCallback(
    (d: number) => {
      const i = VARIANTS.findIndex((v) => v[0] === variant);
      const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0];
      setVariant(next);
      set("variant", next);
    },
    [variant, set],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [step]);

  const label = VARIANTS.find((v) => v[0] === variant)?.[1] ?? "";
  const asOf = data.refreshedAt ? relTime(new Date(data.refreshedAt)) : "never";

  return (
    <div className="main pt" data-variant={variant}>
      <section className="content pt-body">
        {signedOut ? (
          <div className="pt-signin">
            <span className="pt-steam">
              <SteamMark />
            </span>
            <h1>Where do you stand?</h1>
            <p>
              Sign in with Steam to see your place on the Daily Report&apos;s four lists: Maps played,
              Author Medals, world records and top 5s.
            </p>
            <a className="pt-go" href={signInHref("/you")}>
              Sign in with Steam
            </a>
            <small>Steam tells us only your Steam ID. Nothing else is kept.</small>
          </div>
        ) : (
          <>
            <header className="pt-top">
              <Marble who={{ steamId: id, persona }} still />
              <div>
                <h1>{state === "new" ? "No Workshop times yet" : persona}</h1>
                <p className="pt-line">
                  Where you stand on the Daily Report&apos;s lists · data as of {asOf}
                </p>
              </div>
            </header>
            {variant === "A" && <Cards views={views} />}
            {variant === "B" && <Ladders views={views} id={id} />}
            {variant === "C" && <Table views={views} />}
            {variant === "D" && <Image views={views} id={id} data={data} />}
            {variant === "E" && <Chase views={views} />}
          </>
        )}
      </section>
      <Picker
        label={`${variant} · ${label}`}
        onStep={step}
        state={state}
        onState={(s) => {
          setState(s);
          set("state", s);
        }}
      />
    </div>
  );
}

function Picker({
  label,
  onStep,
  state,
  onState,
}: {
  label: string;
  onStep: (d: number) => void;
  state: StateKey;
  onState: (s: StateKey) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (m: PointerEvent) => setPos({ x: m.clientX - dx, y: m.clientY - dy });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <div
      ref={ref}
      className="proto-picker"
      onPointerDown={drag}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
    >
      <div className="pp-row">
        <button type="button" onClick={() => onStep(-1)} aria-label="Previous variant">
          ←
        </button>
        <b>{label}</b>
        <button type="button" onClick={() => onStep(1)} aria-label="Next variant">
          →
        </button>
      </div>
      <div className="pp-states">
        {STATES.map(([k, l]) => (
          <button key={k} type="button" className={k === state ? "on" : ""} onClick={() => onState(k)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
