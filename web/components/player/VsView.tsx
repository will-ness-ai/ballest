"use client";
// The head to head: every Map and Circuit Track two players both have a time on, the
// score between them, the comparison band, and the list with its scope, filter and sort.
// Built from two PlayerRecords by matchup() and nothing else; "change" swaps one side
// through the Compare dialog.
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { CompareDialog, type CompareAsk } from "./Compare";
import { Score, Thumb } from "./pieces";
import { Marble } from "../Marble";
import { matchup, type BandStat, type MatchRow, type PlayerRecord } from "../../lib/player";
import { boardHref, playerHref } from "../../lib/routes";
import {
  SCORE_TICKS_PER_SECOND,
  fmtN,
  fmtTime,
  ord,
  personaOf,
  plural,
  secs,
} from "../../lib/rules";

const VS_CHUNK = 60;
const SCOPES = [
  ["all", "All"],
  ["circuit", "Circuit"],
  ["workshop", "Workshop"],
] as const;
type Scope = (typeof SCOPES)[number][0];
type Filter = "all" | "a" | "b";
const SORTS = {
  close: ["Closest first", (p: MatchRow, q: MatchRow) => p.rel - q.rel],
  big: ["Biggest margins", (p: MatchRow, q: MatchRow) => q.rel - p.rel],
  runs: ["Most runs", (p: MatchRow, q: MatchRow) => q.field - p.field],
} as const;
type Sort = keyof typeof SORTS;

function Side({ rec, side, change }: { rec: PlayerRecord; side: "a" | "b"; change: () => void }) {
  return (
    <div className={side === "b" ? "vsside r" : "vsside"}>
      <Marble who={rec.who} />
      <span>
        <Link className={"c" + side} href={playerHref(rec.id)}>
          {personaOf(rec.who)}
        </Link>{" "}
        <button type="button" className="linkbtn" data-change={side} onClick={change}>
          change
        </button>
      </span>
    </div>
  );
}

function Row({ r }: { r: MatchRow }) {
  const side = (x: { rank: number; score: number }, s: "a" | "b") => (
    <span className={"vside" + (s === "b" ? " r" : "") + (r.win === s ? " w" + s : "")}>
      <b>{fmtTime(x.score)}</b>
      <small>{ord(x.rank)}</small>
    </span>
  );
  return (
    <div className="vrow">
      {side(r.a, "a")}{" "}
      <Link className="vmid" href={boardHref(r.name)}>
        {r.scope === "workshop" ? (
          <Thumb preview={r.preview} />
        ) : (
          <span className="ctag">Circuit</span>
        )}
        <span>
          <b>{r.title}</b>{" "}
          <small>
            {(r.win === "tie"
              ? "tie"
              : Math.abs(r.d) < SCORE_TICKS_PER_SECOND / 1000
                ? "by under 0.001s"
                : "by " + secs(Math.abs(r.d))) +
              " · " +
              plural(r.field, "run", "runs")}
          </small>
        </span>
      </Link>{" "}
      {side(r.b, "b")}
    </div>
  );
}

function Tv({ s, side }: { s: BandStat; side: "a" | "b" }) {
  const v = s[side];
  return (
    <span
      className={
        "tv" + (side === "a" ? " l" : "") + (s.win === side ? " c" + side : s.win ? " lose" : "")
      }
    >
      {v == null ? "—" : s.rank ? ord(v) : fmtN(v)}
    </span>
  );
}

export function VsView({ A, B }: { A: PlayerRecord; B: PlayerRecord }) {
  const m = useMemo(() => matchup(A, B), [A, B]);
  const [scope, setScope] = useState<Scope>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("close");
  const [shown, setShown] = useState(VS_CHUNK);
  const [ask, setAsk] = useState<CompareAsk | null>(null);
  const close = useCallback(() => {
    setAsk(null);
  }, []);

  const t = m.tally[scope];
  const nA = personaOf(A.who),
    nB = personaOf(B.who);
  const what = scope === "circuit" ? ["track", "tracks"] : ["map", "maps"];
  const keep = {
    all: () => true,
    a: (r: MatchRow) => r.win === "a",
    b: (r: MatchRow) => r.win === "b",
  }[filter];
  const rows = m.rows
    .filter((r) => (scope === "all" || r.scope === scope) && keep(r))
    .sort(SORTS[sort][1]);
  /* change one side: the other stays, and the pick takes this side's place */
  const change = (side: "a" | "b") => () => {
    setAsk({ keep: side === "a" ? B.who : A.who, side });
  };

  return (
    <div className="main">
      <section className="content">
        <div className="pp vsp" id="vs">
          <Link className="back" href={playerHref(A.id)}>
            &larr; {nA}
          </Link>{" "}
          <div className="vshead">
            <Side rec={A} side="a" change={change("a")} />{" "}
            <div className="vsmid">
              <Score t={t} />
              <span className="eyebrow">
                {`${fmtN(t.n)} ${t.n === 1 ? what[0] : what[1]} in common`}
              </span>
            </div>{" "}
            <Side rec={B} side="b" change={change("b")} />
          </div>{" "}
          <div className="tape">
            {m.band.map((s) => (
              <div className="trow" key={s.label}>
                <Tv s={s} side="a" />
                <span className="eyebrow">{s.label}</span>
                <Tv s={s} side="b" />
              </div>
            ))}
          </div>{" "}
          <div className="vstools">
            <span className="seg">
              {SCOPES.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  data-scope={k}
                  aria-pressed={scope === k}
                  onClick={() => {
                    setScope(k);
                    setShown(VS_CHUNK);
                  }}
                >
                  {label}
                </button>
              ))}
            </span>{" "}
            <span className="opts">
              {(
                [
                  ["all", "All"],
                  ["a", nA + " faster"],
                  ["b", nB + " faster"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={filter === k ? "opt on" : "opt"}
                  data-filter={k}
                  aria-pressed={filter === k}
                  onClick={() => {
                    setFilter(k);
                    setShown(VS_CHUNK);
                  }}
                >
                  {label}
                </button>
              ))}
            </span>{" "}
            <select
              className="pwsort"
              id="vssort"
              aria-label="Sort"
              value={sort}
              onChange={(e) => {
                setSort(e.currentTarget.value as Sort);
                setShown(VS_CHUNK);
              }}
            >
              {Object.entries(SORTS).map(([k, [label]]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>{" "}
          {!t.n ? (
            <div className="empty">
              <b>Nothing in common yet.</b>
              {nA} and {nB} have no times on the same{" "}
              {scope === "circuit"
                ? "Circuit tracks"
                : scope === "workshop"
                  ? "Workshop maps"
                  : "maps"}
              .
            </div>
          ) : !rows.length ? (
            <div className="empty">
              <b>No {what[1]} here.</b>
            </div>
          ) : (
            <>
              <div className="vlist">
                {rows.slice(0, shown).map((r) => (
                  <Row key={r.scope + r.name} r={r} />
                ))}
              </div>
              {rows.length > shown ? (
                <button
                  type="button"
                  className="more-btn"
                  data-vsmore=""
                  onClick={() => {
                    setShown(shown + VS_CHUNK);
                  }}
                >
                  {`Show ${String(Math.min(VS_CHUNK, rows.length - shown))} more`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>
      <CompareDialog ask={ask} close={close} />
    </div>
  );
}
