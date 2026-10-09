"use client";
// A Track's or a Map's record history, over the board's plates (docs/site.md,
// "A board"). Closed, it is a summary: the record's step chart and the last three Reigns.
// Opened, it becomes the full card in its place, with the Records and What changed tabs.
// Everything it shows is the BoardHistory the server worked out (lib/history.ts).
import { useState } from "react";

import { PlayerLink } from "../PlayerLink";
import {
  changesText,
  cutText,
  dayText,
  gapText,
  heldText,
  longDayText,
  setText,
  type BoardHistory,
  type Reign,
} from "../../lib/history";
import { fmtN, fmtTime, ord } from "../../lib/rules";

/* the history's span as a fraction: where a moment falls between `since` and `now` */
function spanOf(h: BoardHistory) {
  const a = Date.parse(h.since),
    b = Date.parse(h.now);
  return (at: string | null) => (b > a ? ((at ? Date.parse(at) : b) - a) / (b - a) : 1);
}

/* the record as steps across the span, in a W×H box with `pad` above and below */
function steps(h: BoardHistory, W: number, H: number, pad: number) {
  const x = spanOf(h);
  const scores = h.reigns.map((r) => r.score);
  const lo = Math.min(...scores),
    hi = Math.max(...scores);
  /* faster is higher up */
  const y = (s: number) => (hi === lo ? H / 2 : pad + ((s - lo) / (hi - lo)) * (H - 2 * pad));
  let d = "";
  h.reigns.forEach((r, i) => {
    const x1 = x(r.from) * W,
      x2 = x(r.to) * W;
    d += (i ? "L" : "M") + String(x1) + "," + String(y(r.score));
    d += "L" + String(x2) + "," + String(y(r.score));
  });
  return { d, x, y };
}

/* a Reign's bar, and its holder's earlier Reigns faintly behind it on the same track */
function ReignTrack({ h, r }: { h: BoardHistory; r: Reign }) {
  const x = spanOf(h);
  const bar = (q: Reign) => ({
    left: String(x(q.from) * 100) + "%",
    width: `calc(${String((x(q.to) - x(q.from)) * 100)}% + 3px)`,
  });
  return (
    <span className="hi-track">
      {h.reigns
        .filter((q) => q.steamId === r.steamId && q.from < r.from)
        .map((q) => (
          <span key={q.from} className="hi-earlier" style={bar(q)} />
        ))}
      <span className="hi-bar" style={bar(r)} />
    </span>
  );
}

function Axis({ h }: { h: BoardHistory }) {
  return (
    <span className="hi-axis">
      <span>{dayText(h.since)}</span>
      <span>now</span>
    </span>
  );
}

function ReignRow({ h, r, link }: { h: BoardHistory; r: Reign; link: boolean }) {
  return (
    <li className={r.to === null ? "now" : undefined}>
      <b>{fmtTime(r.score)}</b>
      <span className="hi-who">
        {link ? <PlayerLink id={r.steamId} text={r.persona} /> : r.persona}
        {r.cut !== null && <span className="hi-cut"> {cutText(r.cut)}</span>}
        {link && (
          <span className="hi-when">
            {" "}
            {setText(r)} · {heldText(r)}
          </span>
        )}
      </span>
      <ReignTrack h={h} r={r} />
    </li>
  );
}

/* the card's label and the button that opens or closes it */
function Head({ h, open, onToggle }: { h: BoardHistory; open: boolean; onToggle: () => void }) {
  return (
    <div className="hi-head">
      <span className="hi-label">{changesText(h)}</span>
      <button
        type="button"
        className="hi-toggle"
        aria-expanded={open}
        onClick={(ev) => {
          ev.stopPropagation();
          onToggle();
        }}
      >
        {open ? "Hide" : "History"}
      </button>
    </div>
  );
}

/* the closed card: the whole of it opens the history, the button for the keyboard */
function Summary({ h, onOpen }: { h: BoardHistory; onOpen: () => void }) {
  const { d } = steps(h, 800, 46, 4);
  return (
    <section className="hist hi-sum" onClick={onOpen}>
      <Head h={h} open={false} onToggle={onOpen} />
      <svg className="hi-spark" viewBox="0 0 800 46" preserveAspectRatio="none" aria-hidden="true">
        <path d={d} />
      </svg>
      <ul className="hi-reigns">
        {h.reigns
          .slice(-3)
          .reverse()
          .map((r) => (
            <ReignRow key={r.from} h={h} r={r} link={false} />
          ))}
      </ul>
      <Axis h={h} />
    </section>
  );
}

function Records({ h }: { h: BoardHistory }) {
  const W = 800,
    H = 180;
  const { d, x, y } = steps(h, W, H, 10);
  return (
    <>
      <svg className="hi-chart" viewBox={`0 0 ${String(W)} ${String(H)}`} aria-hidden="true">
        <path d={d} />
        {h.reigns.map((r) => (
          <circle
            key={r.from}
            className={r.to === null ? "now" : undefined}
            cx={x(r.from) * W}
            cy={y(r.score)}
            r={4}
          />
        ))}
      </svg>
      <Axis h={h} />
      <ul className="hi-reigns">
        {[...h.reigns].reverse().map((r) => (
          <ReignRow key={r.from} h={h} r={r} link />
        ))}
      </ul>
    </>
  );
}

const DAYS_SHOWN = 7;

function Changed({ h }: { h: BoardHistory }) {
  const [days, setDays] = useState(DAYS_SHOWN);
  if (!h.days.length && !h.climbers.length && !h.arrivals.length)
    return <p className="hi-none">Nothing has changed on this board since {dayText(h.since)}.</p>;
  return (
    <>
      <h3 className="hi-sub">
        Climbers <small>since {dayText(h.weekFrom)}, everyone now in the top 100</small>
      </h3>
      {h.climbers.length ? (
        <table className="hi-climb">
          <thead>
            <tr>
              <th>Now</th>
              <th>Player</th>
              <th>Time</th>
              <th>Places</th>
              <th>Cut</th>
            </tr>
          </thead>
          <tbody>
            {h.climbers.map((c) => (
              <tr key={c.steamId}>
                <td>{c.rank}</td>
                <td>
                  <PlayerLink id={c.steamId} text={c.persona} />
                </td>
                <td>{fmtTime(c.score)}</td>
                <td className="hi-up">▲ {fmtN(c.was - c.rank)}</td>
                <td>{c.cut > 0 ? cutText(c.cut) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hi-none">Nobody in the top 100 moved up this week.</p>
      )}
      {h.arrivals.length > 0 && (
        <p className="hi-new">
          Straight into the top 100 with a first time:{" "}
          {h.arrivals.map((a, i) => (
            <span key={a.steamId}>
              {i ? ", " : ""}
              <PlayerLink id={a.steamId} text={a.persona} /> {ord(a.rank)}
            </span>
          ))}
        </p>
      )}
      <h3 className="hi-sub">By day</h3>
      {h.days.slice(0, days).map((d) => (
        <div key={d.day} className="hi-day">
          <h4>{longDayText(d.day)}</h4>
          <ul>
            {d.records.map((x) => (
              <li key={x.steamId + String(x.score)}>
                <span className="hi-tag rec">Record</span>
                <PlayerLink id={x.steamId} text={x.persona} /> {fmtTime(x.score)}
                {x.beat && (
                  <span className="hi-when">
                    {" "}
                    beat {x.beat.persona} by {gapText(x.beat.cut)}
                  </span>
                )}
              </li>
            ))}
            {d.topTen.map((x) => (
              <li key={x.steamId + String(x.score)}>
                <span className="hi-tag top">Top 10</span>
                <PlayerLink id={x.steamId} text={x.persona} /> {fmtTime(x.score)}{" "}
                <span className="hi-when">{x.cut === null ? "first time" : cutText(x.cut)}</span>
              </li>
            ))}
            <li>
              <span className="hi-tag">Board</span>
              <span className="hi-when">
                {fmtN(d.improved)} improved · {fmtN(d.firstTimes)}{" "}
                {d.firstTimes === 1 ? "first time" : "first times"}
              </span>
            </li>
          </ul>
        </div>
      ))}
      {h.days.length > days && (
        <button type="button" className="hi-more" onClick={() => setDays(days + DAYS_SHOWN)}>
          Earlier days
        </button>
      )}
    </>
  );
}

const TABS = [
  ["records", "Records"],
  ["changed", "What changed"],
] as const;

export function HistoryCard({ h }: { h: BoardHistory }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("records");
  if (!open) return <Summary h={h} onOpen={() => setOpen(true)} />;
  return (
    <section className="hist hi-open">
      <Head h={h} open onToggle={() => setOpen(false)} />
      <div className="hi-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "records" ? <Records h={h} /> : <Changed h={h} />}</div>
    </section>
  );
}
