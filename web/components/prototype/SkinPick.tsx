"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: grill-design for the Chosen Skin picker (claude/prototype-skin-pick). Never
// merged: the winner is rebuilt by /implement-spec. ?variant= picks the design, ?as=<steamId>
// signs the page in as that player, and the pick is kept in this browser's localStorage.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useYou } from "../../hooks/me";
import { playerHref, signOutHref, youHref } from "../../lib/routes";
import { personaOf } from "../../lib/rules";

type Group = "Colours" | "Metals" | "Specials";
export const SKIN_LIST: ReadonlyArray<[asset: string, name: string, group: Group]> = [
  ["DA_Skin_Pink", "Pink", "Colours"],
  ["DA_Skin_PinkLight", "Light Pink", "Colours"],
  ["DA_Skin_Red", "Red", "Colours"],
  ["DA_Skin_RedMid", "Mid Red", "Colours"],
  ["DA_Skin_RedDark", "Dark Red", "Colours"],
  ["DA_Skin_Orange", "Orange", "Colours"],
  ["DA_Skin_OrangeMid", "Mid Orange", "Colours"],
  ["DA_Skin_OrangeDark", "Dark Orange", "Colours"],
  ["DA_Skin_Yellow", "Yellow", "Colours"],
  ["DA_Skin_LimeGreen", "Lime Green", "Colours"],
  ["DA_Skin_Green", "Green", "Colours"],
  ["DA_Skin_GreenMid", "Mid Green", "Colours"],
  ["DA_Skin_GreenDark", "Dark Green", "Colours"],
  ["DA_Skin_Turquiose", "Turquoise", "Colours"],
  ["DA_Skin_Default_Blue", "Blue", "Colours"],
  ["DA_Skin_BlueMid", "Mid Blue", "Colours"],
  ["DA_Skin_BlueDark", "Dark Blue", "Colours"],
  ["DA_Skin_Lavender", "Lavender", "Colours"],
  ["DA_Skin_Purple", "Purple", "Colours"],
  ["DA_Skin_PurpleDark", "Dark Purple", "Colours"],
  ["DA_Skin_Gray", "Gray", "Colours"],
  ["DA_Skin_Default_Black", "Black", "Colours"],
  ["DA_Skin_MedalGold", "Gold", "Metals"],
  ["DA_Skin_MedalSilver", "Silver", "Metals"],
  ["DA_Skin_MedalBronze", "Bronze", "Metals"],
  ["DA_Skin_Pearl", "Pearl", "Metals"],
  ["DA_Skin_Brick", "Brick", "Specials"],
  ["DA_Skin_EyeBall", "Eyeball", "Specials"],
  ["DA_Skin_Ice", "Ice", "Specials"],
  ["DA_Skin_Cosmic1", "Cosmic", "Specials"],
  ["DA_Skin_Magma", "Magma", "Specials"],
  ["DA_LBall", "Leth", "Specials"],
  ["DA_Skin_SnowGlobe", "Snow Globe", "Specials"],
  ["DA_Skin_Disco", "Disco", "Specials"],
  ["DA_Skin_DevSilver", "Spirit", "Specials"],
  ["DA_SpookyBall", "Spooky", "Specials"],
];
const GROUPS: Group[] = ["Colours", "Metals", "Specials"];
const nameOf = (a: string | null) => SKIN_LIST.find((s) => s[0] === a)?.[1] ?? "No skin";
const src = (a: string) => `/skins/${a}.webp`;

const VARIANTS = [
  ["A", "Dialog from your marble", "own"],
  ["B", "Header menu", "own"],
  ["C", "Card on Where you stand", "you"],
  ["D", "Inline grid on your page", "own"],
  ["E", "Spinner on your page", "own"],
] as const;
type VariantKey = (typeof VARIANTS)[number][0];

/* ---------- this browser's prototype state: the URL and localStorage ---------- */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  addEventListener("popstate", l);
  return () => {
    listeners.delete(l);
    removeEventListener("popstate", l);
  };
};
const param = (k: string) =>
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get(k);
export function useVariant(): VariantKey | null {
  const v = useSyncExternalStore(
    subscribe,
    () => param("variant") ?? "A",
    () => null,
  );
  if (v === null) return null;
  return VARIANTS.find((x) => x[0] === v)?.[0] ?? "A";
}
const KEY = "proto-skin";
export function useChosen(): [string | null, (a: string | null) => void] {
  const v = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  return [
    v,
    (a) => {
      try {
        if (a) localStorage.setItem(KEY, a);
        else localStorage.removeItem(KEY);
      } catch {}
      emit();
    },
  ];
}

/* draws the pick into marbles the page already drew (yours in the header and on your page) */
function useSwap(selector: string, asset: string | null) {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(selector).forEach((m) => {
        m.querySelector(".proto-swap")?.remove();
        const ball = m.querySelector<HTMLElement>(".ball");
        if (!ball) return;
        ball.style.display = asset ? "none" : "";
        if (!asset) return;
        const img = document.createElement("img");
        img.className = "ball skin proto-swap";
        img.src = src(asset);
        img.alt = "";
        ball.after(img);
      });
    };
    apply();
    const t = setInterval(apply, 800);
    return () => {
      clearInterval(t);
      document.querySelectorAll(selector + " .proto-swap").forEach((n) => n.remove());
      document
        .querySelectorAll<HTMLElement>(selector + " .ball")
        .forEach((b) => (b.style.display = ""));
    };
  }, [selector, asset]);
}

/* ---------- the shared pieces ---------- */
function Ball({ asset, size }: { asset: string | null; size: number }) {
  return (
    <span className="pk-ball" style={{ "--s": size + "px" } as React.CSSProperties}>
      {asset ? <img src={src(asset)} alt="" /> : <span className="pk-none" />}
    </span>
  );
}

function Grid({
  chosen,
  onPick,
  size = 40,
  groups = true,
}: {
  chosen: string | null;
  onPick: (a: string | null) => void;
  size?: number;
  groups?: boolean;
}) {
  const cell = (a: string | null, name: string) => (
    <button
      key={a ?? "none"}
      type="button"
      className="pk-cell"
      aria-pressed={chosen === a}
      title={name}
      onClick={() => onPick(a)}
    >
      <Ball asset={a} size={size} />
      <span className="pk-name">{name}</span>
    </button>
  );
  if (!groups)
    return (
      <div className="pk-grid">
        {cell(null, "No skin")}
        {SKIN_LIST.map(([a, n]) => cell(a, n))}
      </div>
    );
  return (
    <div className="pk-groups">
      {GROUPS.map((g, i) => (
        <section key={g}>
          <h3 className="eyebrow">{g}</h3>
          <div className="pk-grid">
            {i === 0 ? cell(null, "No skin") : null}
            {SKIN_LIST.filter((s) => s[2] === g).map(([a, n]) => cell(a, n))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- A, D, E: on your own player page ---------- */
export function ProtoOwnPage({ id }: { id: string }) {
  const you = useYou();
  const v = useVariant();
  const [chosen, choose] = useChosen();
  const mine = you.state === "ready" && you.id === id;
  useSwap(".pid .marble", mine ? chosen : null);
  if (!mine || !v) return null;
  if (v === "A") return <VariantA chosen={chosen} choose={choose} />;
  if (v === "D") return <VariantD chosen={chosen} choose={choose} />;
  if (v === "E") return <VariantE chosen={chosen} choose={choose} />;
  return null;
}

function VariantA({
  chosen,
  choose,
}: {
  chosen: string | null;
  choose: (a: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /* the marble itself opens it too */
  useEffect(() => {
    const m = document.querySelector<HTMLElement>(".pid .marble");
    if (!m) return;
    m.classList.add("pkA-edit");
    const open = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      ref.current?.showModal();
    };
    m.addEventListener("click", open, true);
    return () => {
      m.classList.remove("pkA-edit");
      m.removeEventListener("click", open, true);
    };
  }, []);
  return (
    <>
      <button type="button" className="linkbtn pkA-open" onClick={() => ref.current?.showModal()}>
        Change your ball
      </button>
      {createPortal(
        <dialog ref={ref} className="ptsx pkA" aria-labelledby="pkAHead">
          <div className="dh">
            <h2 id="pkAHead">Your ball</h2>
            <button type="button" aria-label="Close" onClick={() => ref.current?.close()}>
              &times;
            </button>
          </div>
          <p className="pk-lead">
            Shown beside your name on every board where the run&apos;s own ball isn&apos;t known.
          </p>
          <Grid
            chosen={chosen}
            onPick={(a) => {
              choose(a);
              ref.current?.close();
            }}
          />
        </dialog>,
        document.body,
      )}
    </>
  );
}

function VariantD({
  chosen,
  choose,
}: {
  chosen: string | null;
  choose: (a: string | null) => void;
}) {
  return (
    <section className="pkD">
      <div className="pkD-head">
        <h2 className="eyebrow">Your ball</h2>
        <span className="pkD-now">{nameOf(chosen)}</span>
      </div>
      <Grid chosen={chosen} onPick={choose} size={32} groups={false} />
      <p className="pk-lead">Only you see this here. Everyone sees your ball on the boards.</p>
    </section>
  );
}

function VariantE({
  chosen,
  choose,
}: {
  chosen: string | null;
  choose: (a: string | null) => void;
}) {
  const all: (string | null)[] = [null, ...SKIN_LIST.map((s) => s[0])];
  const [i, setI] = useState(() => Math.max(0, all.indexOf(chosen)));
  const draft = all[i] ?? null;
  const step = (d: number) => setI((x) => (x + d + all.length) % all.length);
  return (
    <section className="pkE">
      <h2 className="eyebrow">Your ball</h2>
      <div className="pkE-stage">
        <button type="button" aria-label="Previous ball" onClick={() => step(-1)}>
          &lsaquo;
        </button>
        <Ball asset={draft} size={112} />
        <button type="button" aria-label="Next ball" onClick={() => step(1)}>
          &rsaquo;
        </button>
      </div>
      <b className="pkE-name">{nameOf(draft)}</b>
      <small className="pkE-count">
        {i + 1} of {all.length}
      </small>
      {draft === chosen ? (
        <span className="pkE-on">This is your ball</span>
      ) : (
        <button type="button" className="pkE-use" onClick={() => choose(draft)}>
          Use this ball
        </button>
      )}
    </section>
  );
}

/* ---------- B: the header card opens a menu ---------- */
export function ProtoYouMenu() {
  const you = useYou();
  const v = useVariant();
  const [chosen, choose] = useChosen();
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const on = v === "B" && you.state === "ready";
  /* the header card opens the menu instead of going to your page */
  useEffect(() => {
    if (!on) return;
    const card = (e: MouseEvent) => {
      const c = (e.target as Element).closest<HTMLElement>(".youcard");
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      const r = c.getBoundingClientRect();
      setOpen((o) => (o ? null : { top: r.bottom + 6, right: innerWidth - r.right }));
    };
    document.addEventListener("click", card, true);
    return () => document.removeEventListener("click", card, true);
  }, [on]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest(".youcard")) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("click", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", out);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!on || you.state !== "ready") return null;
  return (
    <div className="pkB" ref={box}>
      {open ? (
        <div className="pkB-menu" style={{ top: open.top, right: open.right }}>
          <div className="pkB-me">
            <Ball asset={chosen} size={48} />
            <span>
              <b>{personaOf(you.rec.who)}</b>
              <small>{nameOf(chosen)}</small>
            </span>
          </div>
          <h3 className="eyebrow">Your ball</h3>
          <Grid chosen={chosen} onPick={choose} size={30} groups={false} />
          <Link className="pkB-link" href={playerHref(you.id)} onClick={() => setOpen(null)}>
            Your page &rarr;
          </Link>
          <form method="post" action={signOutHref("/")}>
            <button type="submit" className="pkB-link">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- C: a card at the top of Where you stand ---------- */
export function ProtoYouSection() {
  const you = useYou();
  const v = useVariant();
  const [chosen, choose] = useChosen();
  if (v !== "C" || you.state !== "ready") return null;
  return (
    <section className="pkC">
      <div className="pkC-me">
        <Ball asset={chosen} size={64} />
        <span>
          <small className="eyebrow">Your ball</small>
          <b>{nameOf(chosen)}</b>
          <small>On every board where the run&apos;s own ball isn&apos;t known</small>
        </span>
      </div>
      <div className="pkC-strip">
        {[null, ...SKIN_LIST.map((s) => s[0])].map((a) => (
          <button
            key={a ?? "none"}
            type="button"
            className="pk-cell"
            aria-pressed={chosen === a}
            title={nameOf(a)}
            onClick={() => choose(a)}
          >
            <Ball asset={a} size={44} />
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- the variant picker ---------- */
export function ProtoPicker() {
  const v = useVariant();
  const you = useYou();
  const [chosen] = useChosen();
  useSwap(".youcard .marble", you.state === "ready" ? chosen : null);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const go = (d: number) => {
    const i = VARIANTS.findIndex((x) => x[0] === v);
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length];
    const q = new URLSearchParams(location.search);
    q.set("variant", next[0]);
    const id = you.state === "ready" ? you.id : param("as");
    const path = next[2] === "you" ? youHref() : id ? playerHref(id) : location.pathname;
    const url = path + "?" + q.toString();
    if (path === location.pathname) {
      history.replaceState(history.state, "", url);
      emit();
    } else router.push(url);
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowLeft") goRef.current(-1);
      if (e.key === "ArrowRight") goRef.current(1);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  if (!v) return null;
  const label = VARIANTS.find((x) => x[0] === v)?.[1];
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
        <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
          ←
        </button>
        <b>
          {v} · {label}
        </b>
        <button type="button" onClick={() => go(1)} aria-label="Next variant">
          →
        </button>
      </div>
      {you.state === "none" ? <small>Sign in (or add ?as=&lt;Steam ID&gt;) to see it</small> : null}
    </div>
  );
}
