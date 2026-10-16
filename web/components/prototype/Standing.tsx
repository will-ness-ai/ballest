"use client";
// ============================================================================================
// PROTOTYPE (grill-design, claude/prototype-standing): never merged. Round 1 picked ladders
// (B); round 2 asks the ladder card: five versions of "where you stand on the Daily Report's four lists", with a
// picker (bottom right, ←/→) and states (signed out, a mid-table player, a leader, no times).
// ============================================================================================
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Marble } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { Plates } from "../board/Plates";
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
  ["A", "Top 3 and you (round 1's B)"],
  ["B", "Neighbours only"],
  ["C", "Gap bars"],
  ["D", "Opens to the whole list"],
  ["E", "Podium and ladder"],
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

// ------------------------------------------------------------------ round 2: the ladder card
/* the rows a ladder shows: the top 3, a gap, then two above you, you and one below; the
   top 5 run on unbroken when you're in or near them */
function ladderRows(v: ListView, above = 2, below = 1, top = 3): Array<Row | "gap"> {
  const r = v.ranked;
  if (!v.me) return [...r.slice(0, top), "gap"];
  const i = v.me.place - 1;
  if (i <= top + above) return r.slice(0, Math.max(5, i + 1 + below));
  return [...r.slice(0, top), "gap", ...r.slice(i - above, i + 1 + below)];
}

function LRow({ row, id, extra }: { row: Row; id: string; extra?: React.ReactNode }) {
  return (
    <li className={row.steamId === id ? "ptb-row me" : "ptb-row"}>
      <span className="ptb-pl">{row.place}</span>
      <Marble who={row} still />
      <span className="ptb-name">
        <PlayerLink id={row.steamId} text={row.persona} />
      </span>
      <b className="ptb-n">{fmtN(row.n)}</b>
      {extra}
    </li>
  );
}
const Ghost = () => <li className="ptb-row me ghost">You · not on this list yet</li>;
const Gap = ({ k }: { k: number }) => (
  <li key={"g" + k} className="ptb-gap">
    ⋯
  </li>
);

/* A · as picked: the top 3, then your neighbourhood */
function LadderA({ v, id }: { v: ListView; id: string }) {
  return (
    <section className="ptb-card">
      <h2 className="pt-h">
        {TITLE[v.stat]} <Move v={v} />
      </h2>
      <ol className="ptb-rows">
        {ladderRows(v).map((row, k) => (row === "gap" ? <Gap key={"g" + k} k={k} /> : <LRow key={row.steamId} row={row} id={id} />))}
        {!v.me && <Ghost />}
      </ol>
      <p className="pt-foot">{chaseLine(v)}</p>
    </section>
  );
}

/* B · neighbours only: no top 3, a wider window centred on you, the leader as one line */
function LadderB({ v, id }: { v: ListView; id: string }) {
  const r = v.ranked;
  const i = v.me ? v.me.place - 1 : r.length;
  const from = Math.max(0, i - 3);
  const rows = r.slice(from, i + 3);
  const lead = r[0];
  return (
    <section className="ptb-card">
      <h2 className="pt-h">
        {TITLE[v.stat]} <Move v={v} />
      </h2>
      {lead && from > 0 && (
        <p className="ptB-lead">
          Leader: <b>{lead.persona}</b> · {fmtN(lead.n)}
        </p>
      )}
      <ol className="ptb-rows">
        {rows.map((row) => (
          <LRow key={row.steamId} row={row} id={id} />
        ))}
        {!v.me && <Ghost />}
      </ol>
    </section>
  );
}

/* C · gap bars: each row's count as a bar, the gap to the row above written between them */
function LadderC({ v, id }: { v: ListView; id: string }) {
  const rows = ladderRows(v);
  const max = v.ranked[0]?.n ?? 1;
  return (
    <section className="ptb-card">
      <h2 className="pt-h">
        {TITLE[v.stat]} <Move v={v} />
      </h2>
      <ol className="ptb-rows ptC">
        {rows.map((row, k) => {
          if (row === "gap") return <Gap key={"g" + k} k={k} />;
          const p = rows[k - 1];
          const prev = p && p !== "gap" ? p : null;
          const gap = row.steamId === id && prev ? prev.n - row.n : null;
          return (
            <LRow
              key={row.steamId}
              row={row}
              id={id}
              extra={
                <>
                  <span className="ptC-bar" style={{ "--w": `${(100 * row.n) / max}%` } as React.CSSProperties} />
                  {gap !== null && prev && <span className="ptC-gap">{gap === 0 ? "level" : `−${fmtN(gap)} to ${ord(prev.place)}`}</span>}
                </>
              }
            />
          );
        })}
        {!v.me && <Ghost />}
      </ol>
    </section>
  );
}

/* D · expandable: the top 3 and you, with the whole list opening in place around you */
function LadderD({ v, id }: { v: ListView; id: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector(".me")?.scrollIntoView({ block: "center" });
  }, [open]);
  const r = v.ranked;
  const i = v.me ? v.me.place - 1 : -1;
  const shown: Array<Row | "gap"> = open
    ? r.slice(0, Math.max(i + 26, 50))
    : v.me && i > 3
      ? [...r.slice(0, 3), "gap", v.me]
      : r.slice(0, 4);
  return (
    <section className="ptb-card">
      <h2 className="pt-h">
        {TITLE[v.stat]} <Move v={v} />
      </h2>
      <ol ref={ref} className={open ? "ptb-rows ptD-open" : "ptb-rows"}>
        {shown.map((row, k) => (row === "gap" ? <Gap key={"g" + k} k={k} /> : <LRow key={row.steamId} row={row} id={id} />))}
        {!v.me && <Ghost />}
      </ol>
      <button type="button" className="ptD-more" onClick={() => setOpen(!open)}>
        {open ? "Close" : `Show all ${fmtN(r.length)}`}
      </button>
      <p className="pt-foot">{chaseLine(v)}</p>
    </section>
  );
}

/* E · podium and ladder: the site's marble podium for the top 3, your neighbourhood under it */
function LadderE({ v, id }: { v: ListView; id: string }) {
  const [one, many] = NOUN[v.stat];
  const rows = ladderRows(v).filter((r): r is Row => r !== "gap" && r.place > 3);
  return (
    <section className="ptb-card ptE">
      <h2 className="pt-h">
        {TITLE[v.stat]} <Move v={v} />
      </h2>
      <Plates
        size="small"
        focus={id}
        top={v.ranked.slice(0, 3).map((r) => ({ who: r, score: plural(r.n, one, many), line: "" }))}
      />
      {rows.length > 0 && (
        <ol className="ptb-rows">
          {rows[0] && rows[0].place > 4 && <Gap k={0} />}
          {rows.map((row) => (
            <LRow key={row.steamId} row={row} id={id} />
          ))}
        </ol>
      )}
      {!v.me && (
        <ol className="ptb-rows">
          <Ghost />
        </ol>
      )}
      <p className="pt-foot">{chaseLine(v)}</p>
    </section>
  );
}

const LADDER = { A: LadderA, B: LadderB, C: LadderC, D: LadderD, E: LadderE };
function Ladders({ views, id, variant }: { views: Array<ListView>; id: string; variant: VariantKey }) {
  const L = LADDER[variant];
  return (
    <div className="ptb-grid">
      {views.map((v) => (
        <L key={v.stat} v={v} id={id} />
      ))}
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
            <Ladders views={views} id={id} variant={variant} />
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
