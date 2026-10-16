"use client";
// ============================================================================================
// PROTOTYPE (grill-design, claude/prototype-standing): never merged. Round 1 picked ladders
// (B), round 2 the card (A with Show all); round 3 asks the signed-out page: five versions of "where you stand on the Daily Report's four lists", with a
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
  ["A", "A card on its own"],
  ["B", "Blurred preview"],
  ["C", "Lists open, your row signs in"],
  ["D", "Sign in or find yourself"],
  ["E", "Two steps"],
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

/* the settled card (round 2: A with D's Show all): the top 3, then your neighbourhood, and the
   whole list opening in place around you. Signed out, your row is the way to sign in */
function Ladder({ v, id, signIn }: { v: ListView; id: string; signIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector(".me")?.scrollIntoView({ block: "center" });
  }, [open]);
  const r = v.ranked;
  const i = v.me ? v.me.place - 1 : -1;
  const shown: Array<Row | "gap"> = open ? r.slice(0, Math.max(i + 26, 50)) : ladderRows(v);
  return (
    <section className="ptb-card">
      <h2 className="pt-h">
        {TITLE[v.stat]} <Move v={v} />
      </h2>
      <ol ref={ref} className={open ? "ptb-rows ptD-open" : "ptb-rows"}>
        {shown.map((row, k) => (row === "gap" ? <Gap key={"g" + k} k={k} /> : <LRow key={row.steamId} row={row} id={id} />))}
        {!v.me &&
          (signIn ? (
            <li className="ptb-row me ghost">
              <a href={signInHref("/you")}>Sign in with Steam to see your row</a>
            </li>
          ) : (
            <Ghost />
          ))}
      </ol>
      <button type="button" className="ptD-more" onClick={() => setOpen(!open)}>
        {open ? "Close" : `Show all ${fmtN(r.length)}`}
      </button>
      {!signIn && <p className="pt-foot">{chaseLine(v)}</p>}
    </section>
  );
}

function Ladders({ views, id, signIn }: { views: Array<ListView>; id: string; signIn?: boolean }) {
  return (
    <div className="ptb-grid">
      {views.map((v) => (
        <Ladder key={v.stat} v={v} id={id} signIn={signIn} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ round 3: signed out
function SignInCard({ title = "Where do you stand?" }: { title?: string }) {
  return (
    <div className="pt-signin">
      <span className="pt-steam">
        <SteamMark />
      </span>
      <h1>{title}</h1>
      <p>
        Sign in with Steam to see your place on the Daily Report&apos;s four lists: Maps played,
        Author Medals, world records and top 5s.
      </p>
      <a className="pt-go" href={signInHref("/you")}>
        Sign in with Steam
      </a>
      <small>Steam tells us only your Steam ID. Nothing else is kept.</small>
    </div>
  );
}

/* A · a card on its own, nothing else on the page */
const OutA = () => <SignInCard />;

/* B · the page you'd get, blurred behind the card */
function OutB({ views, id }: { views: Array<ListView>; id: string }) {
  return (
    <div className="ptO-stack">
      <div className="ptO-blur" aria-hidden="true" inert>
        <Ladders views={views} id={id} />
      </div>
      <div className="ptO-over">
        <SignInCard />
      </div>
    </div>
  );
}

/* C · the lists themselves, open to anyone, your row the sign-in */
function OutC({ views }: { views: Array<ListView> }) {
  return (
    <>
      <div className="ptO-bar">
        <span className="pt-steam">
          <SteamMark />
        </span>
        <p>
          <b>Where do you stand?</b> Sign in with Steam and your row shows on every list.
        </p>
        <a className="pt-go" href={signInHref("/you")}>
          Sign in
        </a>
      </div>
      <Ladders views={views} id="" signIn />
    </>
  );
}

/* D · sign in, or find yourself by name without signing in */
function OutD({ data }: { data: ProtoLists }) {
  const [q, setQ] = useState("");
  const hits =
    q.trim().length < 2
      ? []
      : data.rows.filter((r) => r[1].toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  return (
    <div className="pt-signin">
      <span className="pt-steam">
        <SteamMark />
      </span>
      <h1>Where do you stand?</h1>
      <a className="pt-go" href={signInHref("/you")}>
        Sign in with Steam
      </a>
      <p className="ptO-or">or find yourself by name</p>
      <input
        className="ptO-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Your Steam name"
      />
      <ul className="ptO-hits">
        {hits.map((r) => (
          <li key={r[0]}>
            <a href={`/you?variant=D&state=auto&as=${r[0]}`}>{r[1]}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* E · two steps, the second waiting: what the Discord button promised, in order */
function OutE() {
  return (
    <div className="ptO-steps">
      <ol>
        <li className="on">
          <span>1</span>
          <div>
            <b>Sign in with Steam</b>
            <p>So we know which row is yours. Steam tells us only your Steam ID.</p>
            <a className="pt-go" href={signInHref("/you")}>
              Sign in with Steam
            </a>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>See where you stand</b>
            <p>Your place on Maps played, Author Medals, world records and top 5s.</p>
            <div className="ptO-skel" aria-hidden="true">
              {[0, 1, 2, 3].map((k) => (
                <i key={k} />
              ))}
            </div>
          </div>
        </li>
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
    (STATES.find((s) => s[0] === params.get("state"))?.[0] ?? "out") as StateKey,
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
          <>
            {variant === "A" && <OutA />}
            {variant === "B" && <OutB views={views} id={id} />}
            {variant === "C" && <OutC views={viewFor(all, "")} />}
            {variant === "D" && <OutD data={data} />}
            {variant === "E" && <OutE />}
          </>
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
            <Ladders views={views} id={id} />
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
