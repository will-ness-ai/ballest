"use client";
// PROTOTYPE (grill-design: daily standings history). Never merged. Five variants of where
// and how a player's daily standings history shows on /you, picked by ?variant=, with
// ?as=<steamId> standing in for the signed-in player and ?state= for the data's length.
import { useEffect, useMemo, useState } from "react";

import { STANDINGS_STATS, STANDINGS_TITLE } from "../../lib/ladder";
import type { StandingsStat } from "../../lib/rows";
import { fmtN } from "../../lib/rules";

interface Row {
  i: number;
  n: number;
  d: number;
  place: number;
  mv: number;
}
interface Day {
  at: string;
  players: Array<[string, string]>;
  lists: Record<StandingsStat, Array<Row>>;
}
interface Pt {
  at: string;
  n: number;
  place: number;
  d: number;
  mv: number;
  of: number;
}

const VARIANTS = [
  ["A", "Sparkline per card"],
  ["B", "One history chart"],
  ["C", "Day scrubber"],
  ["D", "Week's climbers"],
  ["E", "Your diary"],
] as const;
const STATES = [
  ["real", "Real days"],
  ["long", "60 days (simulated)"],
] as const;
const SHORT: Record<StandingsStat, string> = {
  played: "Maps",
  author: "Authors",
  wr: "WRs",
  top5: "Top 5s",
};
const COLOR: Record<StandingsStat, string> = {
  played: "var(--accent)",
  author: "var(--author)",
  wr: "var(--gold)",
  top5: "var(--a)",
};

const param = (k: string) =>
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k);
function setParam(k: string, v: string) {
  const u = new URL(window.location.href);
  u.searchParams.set(k, v);
  history.replaceState(history.state, "", u);
}
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/* You's points on one list, one per day */
function seriesOf(days: Array<Day>, id: string, stat: StandingsStat): Array<Pt | null> {
  return days.map((d) => {
    const at = d.players.findIndex(([p]) => p === id);
    const r = at < 0 ? undefined : d.lists[stat].find((x) => x.i === at);
    return r
      ? { at: d.at, n: r.n, place: r.place, d: r.d, mv: r.mv, of: d.lists[stat].length }
      : null;
  });
}

/* a stretched copy for judging the charts at 60 days: a seeded walk ending on today */
function simulate(s: Array<Pt | null>, days: number): Array<Pt | null> {
  const last = [...s].reverse().find((p) => p);
  if (!last) return s;
  let seed = last.place * 31 + last.n;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const out: Array<Pt> = [];
  let place = last.place,
    n = last.n;
  for (let k = 0; k < days; k++) {
    const at = new Date(Date.parse(last.at) - k * 86_400_000).toISOString();
    out.unshift({ at, n, place, d: 0, mv: 0, of: last.of });
    const gain = rnd() < 0.55 ? Math.floor(rnd() * 4) : 0;
    n = Math.max(0, n - gain);
    place = Math.max(1, place + (gain ? Math.ceil(rnd() * 6) : Math.round((rnd() - 0.6) * 2)));
  }
  return out.map((p, k) =>
    k ? { ...p, d: p.n - out[k - 1].n, mv: out[k - 1].place - p.place } : p,
  );
}

/* a place line, best place at the top */
function Line({
  pts,
  color,
  w = 220,
  h = 44,
  dots = false,
}: {
  pts: Array<Pt | null>;
  color: string;
  w?: number;
  h?: number;
  dots?: boolean;
}) {
  const got = pts
    .map((p, k) => (p ? { k, p } : null))
    .filter((x): x is { k: number; p: Pt } => !!x);
  if (got.length < 2) return <svg width={w} height={h} className="ph-svg" />;
  const lo = Math.min(...got.map((g) => g.p.place)),
    hi = Math.max(...got.map((g) => g.p.place));
  const x = (k: number) => 3 + (k / (pts.length - 1)) * (w - 6);
  const y = (pl: number) => (hi === lo ? h / 2 : 3 + ((pl - lo) / (hi - lo)) * (h - 6));
  const d = got
    .map((g, j) => `${j ? "L" : "M"}${x(g.k).toFixed(1)},${y(g.p.place).toFixed(1)}`)
    .join("");
  const end = got[got.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ aspectRatio: `${w} / ${h}` }}
      className="ph-svg"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {dots &&
        got.map((g) => <circle key={g.k} cx={x(g.k)} cy={y(g.p.place)} r="2.5" fill={color} />)}
      <circle cx={x(end.k)} cy={y(end.p.place)} r="3.5" fill={color} />
    </svg>
  );
}

const Mv = ({ mv }: { mv: number }) =>
  mv ? (
    <small className="ph-mv" data-dir={mv > 0 ? "up" : "down"}>
      {mv > 0 ? "▲" : "▼"}
      {fmtN(Math.abs(mv))}
    </small>
  ) : null;

export function ProtoHistory() {
  const [variant, setVariant] = useState("A");
  const [state, setState] = useState("real");
  const [days, setDays] = useState<Array<Day> | null>(null);
  const [as, setAs] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setVariant(param("variant") ?? "A");
    setState(param("state") ?? "real");
    setAs(param("as"));
    fetch("/api/proto-history")
      .then((r) => r.json())
      .then(setDays, () => undefined);
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const k = VARIANTS.findIndex(([v]) => v === variant);
      const next =
        VARIANTS[(k + (e.key === "ArrowRight" ? 1 : VARIANTS.length - 1)) % VARIANTS.length][0];
      setVariant(next);
      setParam("variant", next);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [variant]);

  /* You: ?as=, else a player around 40th on Maps played today */
  const you = useMemo(() => {
    if (!days?.length) return null;
    const last = days[days.length - 1];
    if (as) return { id: as, name: last.players.find(([p]) => p === as)?.[1] ?? as };
    const r = last.lists.played.find((x) => x.place >= 40) ?? last.lists.played[0];
    return { id: last.players[r.i][0], name: last.players[r.i][1] };
  }, [days, as]);
  const series = useMemo(() => {
    if (!days || !you) return null;
    return Object.fromEntries(
      STANDINGS_STATS.map((s) => {
        const real = seriesOf(days, you.id, s);
        return [s, state === "long" ? simulate(real, 60) : real];
      }),
    ) as Record<StandingsStat, Array<Pt | null>>;
  }, [days, you, state]);

  const k = VARIANTS.findIndex(([v]) => v === variant);
  const cycle = (by: number) => {
    const next = VARIANTS[(k + by + VARIANTS.length) % VARIANTS.length][0];
    setVariant(next);
    setParam("variant", next);
  };

  return (
    <>
      {/* ===== PROTOTYPE: the variants ===== */}
      <section className="ph" aria-label="Your history">
        {!days || !you || !series ? (
          <p className="ph-note">Reading every day&apos;s standings…</p>
        ) : (
          <>
            <p className="ph-note">
              Prototype: You is <b>{you.name}</b> · {days.length} real days ({dayText(days[0].at)}{" "}
              to {dayText(days[days.length - 1].at)})
              {state === "long" && ", stretched to 60 for the look"}
            </p>
            {variant === "A" && <VarA series={series} />}
            {variant === "B" && <VarB series={series} />}
            {variant === "C" && <VarC days={days} you={you.id} />}
            {variant === "D" && <VarD days={days} you={you.id} />}
            {variant === "E" && <VarE series={series} />}
          </>
        )}
      </section>

      {/* ===== PROTOTYPE: the picker ===== */}
      <div
        className="ph-picker"
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const sx = e.clientX,
            sy = e.clientY,
            r = e.currentTarget.getBoundingClientRect();
          const move = (m: PointerEvent) =>
            setPos({ x: r.left + m.clientX - sx, y: r.top + m.clientY - sy });
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <button type="button" onClick={() => cycle(-1)}>
          ←
        </button>
        <span>
          {variant} · {VARIANTS[k]?.[1]}
        </span>
        <button type="button" onClick={() => cycle(1)}>
          →
        </button>
        {STATES.map(([s, label]) => (
          <button
            key={s}
            type="button"
            data-on={state === s || undefined}
            onClick={() => {
              setState(s);
              setParam("state", s);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

/* A: under each of the four cards' own titles, a line of You's place by day */
function VarA({ series }: { series: Record<StandingsStat, Array<Pt | null>> }) {
  return (
    <div className="ph-a">
      {STANDINGS_STATS.map((s) => {
        const pts = series[s].filter((p): p is Pt => !!p);
        const best = pts.reduce<Pt | null>((b, p) => (!b || p.place < b.place ? p : b), null);
        const first = pts[0],
          last = pts[pts.length - 1];
        return (
          <div key={s} className="ph-card">
            <h3>{STANDINGS_TITLE[s]}</h3>
            {last ? (
              <>
                <Line pts={series[s]} color={COLOR[s]} w={260} />
                <p className="ph-sub">
                  #{fmtN(last.place)} today · best #{fmtN(best?.place ?? 0)} on{" "}
                  {dayText(best?.at ?? last.at)}
                  {first !== last && (
                    <>
                      {" "}
                      · {first.place > last.place ? "up" : "down"}{" "}
                      {fmtN(Math.abs(first.place - last.place))} since {dayText(first.at)}
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="ph-sub">Not on this list yet</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* B: one chart under the cards, a line per list, scaled each to its own range */
function VarB({ series }: { series: Record<StandingsStat, Array<Pt | null>> }) {
  const [range, setRange] = useState(0);
  const cut = (p: Array<Pt | null>) => (range ? p.slice(-range) : p);
  const any = series.played.filter(Boolean) as Array<Pt>;
  return (
    <div className="ph-card ph-b">
      <div className="ph-head">
        <h3>Your places by day</h3>
        <div className="ph-seg">
          {[
            [7, "7 days"],
            [30, "30 days"],
            [0, "All"],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              data-on={range === v || undefined}
              onClick={() => setRange(v as number)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="ph-b-plot">
        {STANDINGS_STATS.map((s) => (
          <div key={s} className="ph-b-row">
            <span className="ph-key" style={{ color: COLOR[s] }}>
              {SHORT[s]}
            </span>
            <Line
              pts={cut(series[s])}
              color={COLOR[s]}
              w={520}
              h={38}
              dots={cut(series[s]).length <= 14}
            />
            <b>
              {([...series[s]].reverse().find(Boolean)?.place ?? 0)
                ? `#${fmtN([...series[s]].reverse().find(Boolean)?.place ?? 0)}`
                : "—"}
            </b>
          </div>
        ))}
      </div>
      <p className="ph-sub">
        {any.length
          ? `${dayText(cut(series.played).find(Boolean)?.at ?? any[0].at)} to ${dayText(any[any.length - 1].at)}`
          : ""}{" "}
        · higher on the line is a better place
      </p>
    </div>
  );
}

/* C: a slider over the days; the four lists as the Daily Report showed them that day */
function VarC({ days, you }: { days: Array<Day>; you: string }) {
  const [k, setK] = useState(days.length - 1);
  const d = days[k];
  const at = d.players.findIndex(([p]) => p === you);
  return (
    <div className="ph-c">
      <div className="ph-card ph-scrub">
        <label>
          <span>
            As of <b>{dayText(d.at)}</b>, 16:00 UTC
          </span>
          <input
            type="range"
            min={0}
            max={days.length - 1}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          />
        </label>
        <div className="ph-seg">
          <button type="button" onClick={() => setK(Math.max(0, k - 1))}>
            ← Day before
          </button>
          <button type="button" onClick={() => setK(Math.min(days.length - 1, k + 1))}>
            Day after →
          </button>
        </div>
      </div>
      <div className="ph-a">
        {STANDINGS_STATS.map((s) => {
          const rows = d.lists[s];
          const yours = rows.find((r) => r.i === at);
          return (
            <div key={s} className="ph-card">
              <h3>{STANDINGS_TITLE[s]}</h3>
              <ol className="ph-top">
                {rows.slice(0, 10).map((r) => (
                  <li key={r.i} data-you={r.i === at || undefined}>
                    <span>{r.place}</span>
                    <span>{d.players[r.i][1]}</span>
                    <b>{fmtN(r.n)}</b>
                    <small>{r.d ? `+${r.d}` : ""}</small>
                    <Mv mv={r.mv} />
                  </li>
                ))}
                {yours && yours.place > 10 && (
                  <li data-you>
                    <span>{yours.place}</span>
                    <span>{d.players[at][1]}</span>
                    <b>{fmtN(yours.n)}</b>
                    <small>{yours.d ? `+${yours.d}` : ""}</small>
                    <Mv mv={yours.mv} />
                  </li>
                )}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* D: who climbed most over the last 7 days, per list, with You's own week on top */
function VarD({ days, you }: { days: Array<Day>; you: string }) {
  const last = days[days.length - 1],
    from = days[Math.max(0, days.length - 8)];
  const placeAt = (d: Day, s: StandingsStat, id: string) => {
    const at = d.players.findIndex(([p]) => p === id);
    return d.lists[s].find((r) => r.i === at);
  };
  return (
    <div className="ph-d">
      <div className="ph-card">
        <h3>
          Your week · {dayText(from.at)} to {dayText(last.at)}
        </h3>
        <div className="ph-week">
          {STANDINGS_STATS.map((s) => {
            const a = placeAt(from, s, you),
              b = placeAt(last, s, you);
            return (
              <div key={s}>
                <span className="ph-key" style={{ color: COLOR[s] }}>
                  {SHORT[s]}
                </span>
                <b>{b ? `#${fmtN(b.place)}` : "—"}</b>
                {a && b && <Mv mv={a.place - b.place} />}
                {b && <small>+{fmtN(b.n - (a?.n ?? 0))}</small>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ph-a">
        {STANDINGS_STATS.map((s) => {
          const climbers = last.lists[s]
            .map((r) => {
              const id = last.players[r.i][0];
              const a = placeAt(from, s, id);
              return {
                name: last.players[r.i][1],
                id,
                mv: (a?.place ?? last.lists[s].length) - r.place,
                gain: r.n - (a?.n ?? 0),
                place: r.place,
              };
            })
            .sort((x, y) => y.gain - x.gain || y.mv - x.mv)
            .slice(0, 5);
          return (
            <div key={s} className="ph-card">
              <h3>Climbers: {STANDINGS_TITLE[s].replace("Most ", "")}</h3>
              <ol className="ph-top">
                {climbers.map((c) => (
                  <li key={c.id} data-you={c.id === you || undefined}>
                    <span>{c.place}</span>
                    <span>{c.name}</span>
                    <b>+{fmtN(c.gain)}</b>
                    <Mv mv={c.mv} />
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* E: a row per day, newest first: You's place and gain on each list */
function VarE({ series }: { series: Record<StandingsStat, Array<Pt | null>> }) {
  const n = series.played.length;
  return (
    <div className="ph-card ph-e">
      <h3>Your days</h3>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            {STANDINGS_STATS.map((s) => (
              <th key={s} style={{ color: COLOR[s] }}>
                {SHORT[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, j) => n - 1 - j).map((k) => (
            <tr key={k}>
              <td>
                {dayText((STANDINGS_STATS.map((s) => series[s][k]).find(Boolean) ?? { at: "" }).at)}
              </td>
              {STANDINGS_STATS.map((s) => {
                const p = series[s][k];
                return (
                  <td key={s}>
                    {p ? (
                      <>
                        #{fmtN(p.place)} <Mv mv={p.mv} /> {p.d ? <small>+{p.d}</small> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
