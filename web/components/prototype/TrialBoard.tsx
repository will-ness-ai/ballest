/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: round 2, a Trial's own board page (claude/prototype-official). Each variant's
// part is wrapped in <V k="...">, so the server draws them all and the picker shows one.
import Link from "next/link";

import { Marble } from "../Marble";
import { fmtN, fmtTime, plural } from "../../lib/rules";
import { TRIALS, type Trial } from "./trials-data";

const who = (r: Trial["top"][number]) => ({
  steamId: r.steamId,
  persona: r.persona,
  avatar: r.avatar,
});

function Pic({ t, className }: { t: Trial; className: string }) {
  return t.picture ? (
    <img className={className} src={t.picture} alt="" />
  ) : (
    <span className={`${className} tp-ph`} aria-hidden>
      <span>Tower picture</span>
    </span>
  );
}

/* A and C: the rail's Trials as text strips, like a season's Overall rows */
export function TrialRailText({ current }: { current: string }) {
  return TRIALS.map((t) => (
    <Link
      key={t.board}
      className="tstrip plain tr-strip"
      href={t.href}
      aria-current={t.board === current}
    >
      <span className="lab">
        <b>{t.title}</b>
        <span className="rt">{fmtTime(t.top[0].score)}</span>{" "}
        <small>
          {plural(t.players, "run", "runs")}
          {t.status === "Closed" ? " · closed" : ""}
        </small>
      </span>
    </Link>
  ));
}

/* E: the rail's Trials as picture cards */
export function TrialRailPics({ current }: { current: string }) {
  return TRIALS.map((t) => (
    <Link key={t.board} className="tr-pcard" href={t.href} aria-current={t.board === current}>
      <Pic t={t} className="tr-ppic" />
      <span className="tr-pin">
        <b>{t.title}</b>
        <span className="tr-prec">
          <Marble who={who(t.top[0])} still /> {fmtTime(t.top[0].score)}
        </span>
        <small>
          {plural(t.players, "run", "runs")}
          {t.status === "Closed" ? " · closed" : ""}
        </small>
      </span>
    </Link>
  ));
}

/* B: the two Tower boards as one two-way switch */
export function TowerSwitch({ current }: { current: string }) {
  return (
    <div className="tr-sw">
      <Link className="tr-back" href="/trials">
        &larr; All Trials
      </Link>
      <div className="tr-seg" role="group" aria-label="The Tower">
        {TRIALS.filter((t) => t.board.startsWith("Map_TheTower")).map((t) => (
          <Link key={t.board} href={t.href} aria-current={t.board === current}>
            {t.board.endsWith("CP") ? "Checkpoints" : "No checkpoints"}
            <small>{fmtN(t.players)} runs</small>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* C: both Tower records in one card, the other one a link */
export function BothRecords({ current }: { current: string }) {
  const pair = TRIALS.filter((t) => t.board.startsWith("Map_TheTower"));
  return (
    <div className="tr-both">
      <Pic t={pair[0]} className="tr-bpic" />
      <div className="tr-bsides">
        {pair.map((t) => {
          const on = t.board === current;
          const inner = (
            <>
              <span className="eyebrow">
                {t.board.endsWith("CP") ? "Checkpoints" : "No checkpoints"}
              </span>
              <b className="tr-btime">{fmtTime(t.top[0].score)}</b>
              <span className="tr-bwho">
                <Marble who={who(t.top[0])} still /> {t.top[0].persona} · {fmtN(t.players)} runs
              </span>
              {!on && <span className="tr-bgo">See this board &rarr;</span>}
            </>
          );
          return on ? (
            <div key={t.board} className="tr-bside on">
              {inner}
            </div>
          ) : (
            <Link key={t.board} className="tr-bside" href={t.href}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* D: the three Trials as small picture cards over the board */
export function TrialCards({ current }: { current: string }) {
  return (
    <nav className="tr-cards" aria-label="Trials">
      {TRIALS.map((t) => (
        <Link key={t.board} className="tr-card" href={t.href} aria-current={t.board === current}>
          <Pic t={t} className="tr-cpic" />
          <span className="tr-cin">
            <b>{t.title}</b>
            <small>
              {fmtTime(t.top[0].score)} · {fmtN(t.players)} runs
            </small>
          </span>
        </Link>
      ))}
    </nav>
  );
}
