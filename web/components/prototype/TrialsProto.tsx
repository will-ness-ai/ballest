"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: the five ways /trials could list the Trials. Data is a snapshot read from
// Steam on 2026-10-29 (lib/proto-trials.json), since no Tower board is in a database yet.
import Link from "next/link";

import { Marble } from "../Marble";
import { fmtN, fmtTime, plural } from "../../lib/rules";
import data from "../../lib/proto-trials.json";
import { ProtoPicker, setParam, useParam, useVariant } from "./Proto";

type Row = (typeof data)[number]["top"][number];
interface Trial {
  board: string;
  title: string;
  players: number;
  top: Array<Row>;
  href: string;
  blurb: string;
  picture: string | null;
  status: string;
}
const EXTRA: Record<string, Pick<Trial, "href" | "blurb" | "picture" | "status">> = {
  Map_TheTower: {
    href: "/board/Map_TheTower",
    blurb: "The climb to the top, no checkpoints.",
    picture: null,
    status: "Open",
  },
  Map_TheTowerCP: {
    href: "/board/Map_TheTowerCP",
    blurb: "The same climb, with checkpoints.",
    picture: null,
    status: "Open",
  },
  Map_LethTrial_01: {
    href: "/campaign/leth-trials/leth-trial-1",
    blurb: "Lethamyr's one-off event board.",
    picture: "/leth/screenshot.jpg",
    status: "Closed",
  },
};
const TRIALS: Array<Trial> = data.map((t) => ({ ...t, ...EXTRA[t.board] }));
const who = (r: Row) => ({ steamId: r.steamId, persona: r.persona, avatar: r.avatar });
const name = (r: Row) => r.persona ?? r.steamId;

function Pic({ t, className }: { t: Trial; className: string }) {
  return t.picture ? (
    <img className={className} src={t.picture} alt="" />
  ) : (
    <span className={`${className} tp-ph`} aria-hidden>
      <span>Tower picture from the game files</span>
    </span>
  );
}

function Rec({ t }: { t: Trial }) {
  const r = t.top[0];
  return (
    <span className="tp-rec">
      <Marble who={who(r)} still />
      <span>
        <b>{name(r)}</b> <span className="tp-time">{fmtTime(r.score)}</span>
      </span>
    </span>
  );
}

/* A: a card per Trial in a grid, picture on top */
function Cards() {
  return (
    <div className="tpA">
      {TRIALS.map((t) => (
        <Link key={t.board} className="tpA-card" href={t.href}>
          <Pic t={t} className="tpA-pic" />
          <span className="tpA-in">
            <span className="eyebrow">
              Trial · {t.status} · {plural(t.players, "player", "players")}
            </span>
            <b className="tpA-t">{t.title}</b>
            <span className="tp-dim">{t.blurb}</span>
            <Rec t={t} />
          </span>
        </Link>
      ))}
    </div>
  );
}

/* B: wide banners, like /campaigns, the picture behind a fade */
function Banners() {
  return (
    <div className="tpB">
      {TRIALS.map((t) => (
        <Link key={t.board} className="tpB-ban" href={t.href}>
          <Pic t={t} className="tpB-pic" />
          <span className="tpB-in">
            <span className="eyebrow">
              Trial · {t.status} · {plural(t.players, "player", "players")}
            </span>
            <b className="tpB-t">{t.title}</b>
            <span className="tp-dim">{t.blurb}</span>
            <Rec t={t} />
          </span>
        </Link>
      ))}
    </div>
  );
}

/* C: one compact table, a row per Trial */
function Table() {
  return (
    <div className="tpC">
      <div className="tpC-h" aria-hidden>
        <span />
        <span>Trial</span>
        <span>Record</span>
        <span className="tpC-n">Players</span>
      </div>
      {TRIALS.map((t) => (
        <Link key={t.board} className="tpC-row" href={t.href}>
          <Pic t={t} className="tpC-pic" />
          <span className="tpC-name">
            <b>{t.title}</b>
            <span className="tp-dim">{t.status}</span>
          </span>
          <Rec t={t} />
          <span className="tpC-n">{fmtN(t.players)}</span>
        </Link>
      ))}
    </div>
  );
}

/* D: each Trial with its podium, the picture as a thin header */
function Podiums() {
  return (
    <div className="tpD">
      {TRIALS.map((t) => (
        <section key={t.board} className="tpD-box">
          <Link className="tpD-head" href={t.href}>
            <Pic t={t} className="tpD-pic" />
            <span className="tpD-hin">
              <b>{t.title}</b>
              <span className="tp-dim">
                {t.status} · {plural(t.players, "player", "players")}
              </span>
            </span>
          </Link>
          <ol className="tpD-pod">
            {t.top.slice(0, 3).map((r, i) => (
              <li key={r.steamId} className={`tpD-p p${i + 1}`}>
                <span className="tpD-rk">{i + 1}</span>
                <Marble who={who(r)} still />
                <span className="tpD-nm">{name(r)}</span>
                <span className="tp-time">{fmtTime(r.score)}</span>
              </li>
            ))}
          </ol>
          <Link className="tpD-all" href={t.href}>
            Full board &rarr;
          </Link>
        </section>
      ))}
    </div>
  );
}

/* E: no list: the page is a board, with a switch between the Trials over it */
function Board() {
  const at = useParam("trial");
  const t = TRIALS.find((x) => x.board === at) ?? TRIALS[0];
  return (
    <div className="tpE">
      <div className="tpE-sw" role="tablist">
        {TRIALS.map((x) => (
          <button
            key={x.board}
            type="button"
            role="tab"
            aria-selected={x === t}
            onClick={() => setParam("trial", x.board)}
          >
            {x.title}
          </button>
        ))}
      </div>
      <div className="tpE-card">
        <Pic t={t} className="tpE-pic" />
        <span className="tpE-in">
          <span className="eyebrow">
            Trial · {t.status} · {plural(t.players, "player", "players")}
          </span>
          <b className="tpA-t">{t.title}</b>
          <span className="tp-dim">{t.blurb}</span>
        </span>
      </div>
      <ol className="tpE-rows">
        {t.top.map((r) => (
          <li key={r.steamId}>
            <span className="tpD-rk">{r.rank}</span>
            <Marble who={who(r)} still />
            <span className="tpD-nm">{name(r)}</span>
            <span className="tp-time">{fmtTime(r.score)}</span>
          </li>
        ))}
      </ol>
      <Link className="tpD-all" href={t.href}>
        All {fmtN(t.players)} players &rarr;
      </Link>
    </div>
  );
}

export function TrialsProto() {
  const v = useVariant();
  return (
    <>
      {/* PROTOTYPE */}
      {v === "A" && <Cards />}
      {v === "B" && <Banners />}
      {v === "C" && <Table />}
      {v === "D" && <Podiums />}
      {v === "E" && <Board />}
      <ProtoPicker />
    </>
  );
}
