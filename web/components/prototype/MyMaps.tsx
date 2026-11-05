"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: a player's times on your Maps (claude/prototype-mymaps). Never merged.
import Link from "next/link";

import { useParam, setParam, useVariant } from "./Proto";
import { useYou } from "../../hooks/me";
import type { MadeMap, PlayerRecord, WorkshopFinish } from "../../lib/player";
import { boardHref } from "../../lib/routes";
import { fmtN, fmtTime, ord, personaOf, plural, shortGap } from "../../lib/rules";
import { MapImage } from "../MapImage";
import { Medal } from "../Medal";

export interface YourMaps {
  you: string;
  made: ReadonlyArray<MadeMap>;
  finished: Array<WorkshopFinish>;
  unfinished: Array<MadeMap>;
}

/* the Maps You made, split into the ones this player finished and the rest; null when
   signed out, on your own page, or when you made none */
export function useYourMaps(id: string, finishes: ReadonlyArray<WorkshopFinish>): YourMaps | null {
  const you = useYou();
  if (you.state !== "ready" || you.id === id || !you.rec.made.length) return null;
  const by = new Map(finishes.map((f) => [f.name, f]));
  const made = you.rec.made;
  return {
    you: you.id,
    made,
    finished: made.flatMap((m) => {
      const f = by.get(m.name);
      return f ? [f] : [];
    }),
    unfinished: made.filter((m) => !by.has(m.name)),
  };
}

/* "Not finished yet": your Maps this player holds no time on */
export function Unfinished({ y, id }: { y: YourMaps; id: string }) {
  if (!y.unfinished.length) return null;
  return (
    <p className="ym-unf">
      <b>{`Not finished yet · ${fmtN(y.unfinished.length)}`}</b>{" "}
      {y.unfinished.map((m, i) => (
        <span key={m.name}>
          {i ? ", " : ""}
          {m.record ? <Link href={boardHref(m.name, id)}>{m.display}</Link> : m.display}
        </span>
      ))}
    </p>
  );
}

/* A: the score card's second link */
export function ScoreCardLink({ rec }: { rec: PlayerRecord }) {
  const v = useVariant();
  const y = useYourMaps(rec.id, rec.workshop.finishes);
  if (v !== "A" || !y) return null;
  return (
    <button
      type="button"
      className="go ym-go"
      onClick={() => {
        setParam("mine", "1");
        const tab = location.pathname.split("/")[3];
        if (tab && tab !== "workshop") {
          location.href =
            "/player/" + rec.id + "/workshop" + location.search;
          return;
        }
        document.getElementById("pwall")?.scrollIntoView({ block: "start" });
      }}
    >
      {`Their times on your maps · ${fmtN(y.finished.length)} of ${fmtN(y.made.length)}`} &rarr;
    </button>
  );
}

function YourRow({ f, id }: { f: WorkshopFinish; id: string }) {
  return (
    <Link className="ym-row" href={boardHref(f.name, id)}>
      <MapImage preview={f.preview} frame /> <b>{f.display}</b>{" "}
      <span className="wrk" data-m={f.rank <= 3 ? f.rank : 0}>
        {f.rank}
        <sup>{ord(f.rank).slice(-2)}</sup>
        <small>{"/" + fmtN(f.field)}</small>
      </span>{" "}
      <span className="wtm">
        {fmtTime(f.score)}
        <small>{f.rank === 1 ? "record" : shortGap(f.gap)}</small>
      </span>{" "}
      <Medal t={f.medal} size={18} mini />
    </Link>
  );
}

/* D: a panel opening the Workshop tab */
export function Panel({ rec }: { rec: PlayerRecord }) {
  const v = useVariant();
  const y = useYourMaps(rec.id, rec.workshop.finishes);
  if (v !== "D" || !y) return null;
  return (
    <section className="ym-panel">
      <h2 className="eyebrow">
        {`${personaOf(rec.who)} on your maps · ${fmtN(y.finished.length)} of ${fmtN(y.made.length)} finished`}
      </h2>
      <div className="ym-list">
        {y.finished
          .sort((a, b) => a.rank - b.rank)
          .map((f) => (
            <YourRow key={f.name} f={f} id={rec.id} />
          ))}
      </div>
      <Unfinished y={y} id={rec.id} />
    </section>
  );
}

/* E: the tab pill and the tab's body */
export function TabPill({ rec }: { rec: PlayerRecord }) {
  const v = useVariant();
  const mine = useParam("mine") === "1";
  const y = useYourMaps(rec.id, rec.workshop.finishes);
  if (v !== "E" || !y) return null;
  return (
    <button
      type="button"
      className="pill ym-pill"
      aria-pressed={mine}
      onClick={() => setParam("mine", mine ? null : "1")}
    >
      Your maps <span className="ym-n">{fmtN(y.finished.length)}</span>
    </button>
  );
}

export function TabBody({ rec, children }: { rec: PlayerRecord; children: React.ReactNode }) {
  const v = useVariant();
  const mine = useParam("mine") === "1";
  const y = useYourMaps(rec.id, rec.workshop.finishes);
  if (v !== "E" || !mine || !y) return <>{children}</>;
  return (
    <div className="pws">
      <p className="wsline">
        {`${fmtN(y.finished.length)} of your ${plural(y.made.length, "map", "maps")} finished · ${plural(y.finished.filter((f) => f.rank <= 3).length, "podium", "podiums")} · ${plural(y.finished.filter((f) => f.rank === 1).length, "record", "records")}`}
      </p>
      <div className="ym-list">
        {y.finished
          .sort((a, b) => a.rank - b.rank)
          .map((f) => (
            <YourRow key={f.name} f={f} id={rec.id} />
          ))}
      </div>
      <Unfinished y={y} id={rec.id} />
    </div>
  );
}
