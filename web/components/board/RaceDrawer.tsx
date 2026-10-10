"use client";
// The race drawer under a row whose run has a Ghost profile: the date the run was set and
// its top speed, then a card racing it against its rival (the leader, or 2nd for the
// leader) as two marbles over a gap chart along the course. Race starts the race, and a
// drag on the chart moves it. It reads the run from /api/board/<name>?run= when it opens.
// One drawer is open at a time on a page, under the podium or under a row of the list
// (useRaceOpen).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { gapAtLine, gaps, raceDrawerId, raceEnd, reached, timeAt } from "../../lib/race";
import type { RunRace } from "../../lib/rows";
import { SCORE_TICKS_PER_SECOND, fmtTime, hueFor, ord } from "../../lib/rules";

/* the page's one open drawer, as board, place and Steam ID: the podium and the list are
   separate components, and the same run can show in both while a search is on */
let opened: string | null = null;
const readers = new Set<() => void>();
const listen = (read: () => void) => {
  readers.add(read);
  return () => {
    readers.delete(read);
  };
};

/* which run on `board` has its drawer open at `place`; a second tap on the same run closes
   it, and a tap elsewhere moves it */
export function useRaceOpen(board: string, place: "podium" | "list") {
  const at = `${board}|${place}|`;
  const now = useSyncExternalStore(
    listen,
    () => opened,
    () => null,
  );
  const toggle = useCallback(
    (steamId: string) => {
      opened = opened === at + steamId ? null : at + steamId;
      for (const read of readers) read();
    },
    [at],
  );
  return { open: now?.startsWith(at) ? now.slice(at.length) : null, toggle };
}

const clock = (s: number) => fmtTime(Math.round(s * SCORE_TICKS_PER_SECOND));
const signed = (s: number) => (s >= 0 ? "+" : "−") + clock(s);
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

type Read = { state: "loading" } | { state: "failed" } | { state: "done"; run: RunRace | null };

export function RaceDrawer({
  board,
  steamId,
  podium = false,
}: {
  board: string;
  steamId: string;
  /* under the podium rather than under a row */
  podium?: boolean;
}) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  useEffect(() => {
    const stop = new AbortController();
    fetch(`/api/board/${encodeURIComponent(board)}?run=${steamId}`, { signal: stop.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`run ${board} ${steamId}: ${String(res.status)}`);
        setRead({ state: "done", run: (await res.json()) as RunRace | null });
      })
      .catch(() => {
        if (!stop.signal.aborted) setRead({ state: "failed" });
      });
    return () => {
      stop.abort();
    };
  }, [board, steamId]);
  return (
    <div
      className={podium ? "race-drawer race-podium" : "race-drawer"}
      id={raceDrawerId(steamId)}
      style={{ "--h": hueFor(steamId) } as React.CSSProperties}
    >
      {read.state === "loading" ? (
        <p className="race-meta">Loading the run</p>
      ) : read.state === "failed" || !read.run ? (
        <p className="race-meta">This run could not be loaded.</p>
      ) : (
        <RaceRun run={read.run} />
      )}
    </div>
  );
}

function RaceRun({ run }: { run: RunRace }) {
  return (
    <div className="race-run">
      <p className="race-meta">
        {run.setAt ? (
          <>
            Set <b>{dateOf(run.setAt)}</b>
          </>
        ) : (
          "Date not recorded"
        )}
        {run.topSpeed != null && (
          <>
            <span aria-hidden="true"> · </span>
            Top speed <b className="race-num">{run.topSpeed.toFixed(1)} km/h</b>
          </>
        )}
      </p>
      {run.rival && <RaceCard run={run.profile} rival={run.rival} />}
    </div>
  );
}

/* the race clock: t runs from 0 to the slower run's finish, then stops; play restarts it */
function useRace(end: number) {
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      setT(Math.min(s, end));
      if (s >= end) setRunning(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [running, end]);
  return {
    t,
    running,
    play: () => {
      setT(0);
      setRunning(true);
    },
    seek: (s: number) => {
      setRunning(false);
      setT(Math.max(0, Math.min(end, s)));
    },
  };
}

const W = 600,
  H = 100;

function RaceCard({ run, rival }: { run: Array<number>; rival: NonNullable<RunRace["rival"]> }) {
  const race = useRace(raceEnd(run, rival.profile));
  const vs = rival.rank === 1 ? "the leader" : ord(rival.rank);
  const runAt = reached(run, race.t);
  const rivalAt = reached(rival.profile, race.t);
  return (
    <div className="race-card">
      <div className="race-bar">
        <p>
          Against {vs} · <b className="race-num">{signed(gapAtLine(run, rival.profile))}</b> at the
          line
        </p>
        <span className="race-clock race-num">{clock(race.t)}</span>
        <button type="button" className="race-btn" onClick={race.play}>
          {race.running ? "Racing" : race.t ? "Replay" : "Race"}
        </button>
      </div>
      <div className="race-lanes">
        <div className="race-lane">
          <span>{rival.rank === 1 ? "Leader" : vs}</span>
          <i
            className="race-ball race-ball-rival"
            style={{ insetInlineStart: `${(rivalAt * 100).toFixed(2)}%` }}
          />
        </div>
        <div className="race-lane">
          <span>This run</span>
          <i className="race-ball" style={{ insetInlineStart: `${(runAt * 100).toFixed(2)}%` }} />
        </div>
      </div>
      <GapChart run={run} rival={rival.profile} at={race.t > 0 ? runAt : null} seek={race.seek} />
      <div className="race-axis">
        <span>Start</span>
        <span>Finish</span>
      </div>
    </div>
  );
}

/* the gap to the rival along the course, ahead above the line; a drag moves the race to
   the time this run reached that point */
function GapChart({
  run,
  rival,
  at,
  seek,
}: {
  run: Array<number>;
  rival: Array<number>;
  at: number | null;
  seek: (s: number) => void;
}) {
  const gap = gaps(run, rival);
  const max = Math.max(0.02, ...gap.map(Math.abs));
  const y = (d: number) => H / 2 + (d / max) * (H / 2 - 8);
  const x = (i: number) => ((i + 1) / gap.length) * W;
  const onScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    else if (e.buttons !== 1) return;
    const box = e.currentTarget.getBoundingClientRect();
    seek(timeAt(run, (e.clientX - box.left) / box.width));
  };
  return (
    <div className="race-gap" onPointerDown={onScrub} onPointerMove={onScrub}>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="race-zero" />
        <polyline
          points={
            `0,${String(H / 2)} ` + gap.map((d, i) => `${String(x(i))},${String(y(d))}`).join(" ")
          }
          className="race-line"
        />
        {at != null && <line x1={at * W} x2={at * W} y1="0" y2={H} className="race-head" />}
      </svg>
      <span className="race-on race-on-up">Ahead</span>
      <span className="race-on race-on-dn">Behind</span>
    </div>
  );
}
