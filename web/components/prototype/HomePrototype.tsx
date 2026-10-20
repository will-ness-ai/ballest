"use client";
// PROTOTYPE — round 1: five structures for the homepage's featured Maps.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MapImage } from "../MapImage";
import { CreatorLink, PodLine } from "../workshop/Card";
import { mapHref } from "../../lib/routes";
import { fmtN, fmtTime } from "../../lib/rules";
import { recordOf, whyOf, type Pick } from "../../lib/workshop";

const variants = [
  {
    key: "A",
    name: "Focused feature",
    note: "One map at a time, full podium and manual tabs. Smaller, uncropped image; removes auto-rotation.",
  },
  {
    key: "B",
    name: "Lead + four",
    note: "Fixed lead with full podium; four picks keep their category metric and WR, omitting other stats and podiums. No auto-rotation.",
  },
  {
    key: "C",
    name: "Discovery cards",
    note: "Five equal cards; swipe on phones. All three stats and the record holder stay; removes 2nd/3rd places and rotation.",
  },
  {
    key: "D",
    name: "Pick a reason",
    note: "A list of five factual reasons selects one map. Full selected-map stats and podium, with a smaller picture; removes auto-rotation.",
  },
  {
    key: "E",
    name: "Records digest",
    note: "A compact, image-light list of all five picks. Keeps all three stats and record holder; removes 2nd/3rd places and rotation.",
  },
] as const;

function Facts({ p }: { p: Pick }) {
  return (
    <div className="hp-facts">
      <span>
        <b>{fmtN(p.m.entryCount)}</b>players with a time
      </span>
      <span>
        <b>{fmtTime(recordOf(p.m))}</b>world record
      </span>
      <span>
        <b>{fmtN(p.m.sessions)}</b>play sessions
      </span>
    </div>
  );
}

function Detail({ p, now }: { p: Pick; now: number }) {
  return (
    <article className="hp-detail">
      <div className="hp-picture">
        <MapImage preview={p.m.preview} />
      </div>
      <div className="hp-copy">
        <span className="hp-kicker">
          {p.label} · {whyOf(p, now)}
        </span>
        <h2>{p.m.title}</h2>
        <span className="hp-by">
          by <CreatorLink m={p.m} />
        </span>
        <Facts p={p} />
        <div className="hp-podium">
          {p.m.top3.map((person, i) => (
            <PodLine key={i} p={person} i={i} />
          ))}
        </div>
        <Link className="go" href={mapHref(p.m.pfid)}>
          View leaderboard &rarr;
        </Link>
      </div>
    </article>
  );
}

function Mini({ p, now }: { p: Pick; now: number }) {
  return (
    <article className="hp-mini">
      <Link className="hp-mini-pic" href={mapHref(p.m.pfid)}>
        <MapImage preview={p.m.preview} />
      </Link>
      <div>
        <span className="hp-kicker">{p.label}</span>
        <h3>
          <Link href={mapHref(p.m.pfid)}>{p.m.title}</Link>
        </h3>
        <span className="hp-by">by {p.m.creator}</span>
        <span className="hp-metric">{whyOf(p, now)}</span>
        <span className="hp-small-record">WR {fmtTime(recordOf(p.m))}</span>
      </div>
    </article>
  );
}

export function HomePrototype({ picks, now }: { picks: ReadonlyArray<Pick>; now: number }) {
  const params = useSearchParams();
  const initial = params.get("variant") ?? "A";
  const [key, setKey] = useState(variants.some((v) => v.key === initial) ? initial : "A");
  const [phone, setPhone] = useState(params.get("view") === "phone");
  const [selected, setSelected] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const variant = variants.find((v) => v.key === key) ?? variants[0];
  const framed = params.get("framed") === "1";
  const choose = (next: string) => {
    setKey(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  };
  const cycle = (delta: number) =>
    choose(variants[(variants.indexOf(variant) + delta + variants.length) % variants.length].key);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches("input, textarea, select") || e.target.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const idx = variants.findIndex((v) => v.key === key);
        const next =
          variants[(idx + (e.key === "ArrowRight" ? 1 : -1) + variants.length) % variants.length]
            .key;
        setKey(next);
        const url = new URL(window.location.href);
        url.searchParams.set("variant", next);
        window.history.replaceState(null, "", url);
      }
    };
    if (!framed) window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [key, framed]);
  const setView = (value: boolean) => {
    setPhone(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("view", "phone");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };
  const frameQuery = new URLSearchParams(params.toString());
  frameQuery.set("variant", key);
  frameQuery.set("framed", "1");
  frameQuery.delete("view");
  const p = (picks[selected] ?? picks[0]) as Pick | undefined;
  if (!p) return null;
  return (
    <>
      <section className={"hp-feature hp-" + key} aria-label="Featured Workshop maps">
        <div className="hp-heading">
          <span className="hp-kicker">Explore the Workshop</span>
          <span>Five maps. Five reasons to play.</span>
        </div>
        {key === "A" && (
          <>
            <Detail p={p} now={now} />
            <div className="hp-tabs">
              {picks.map((x, i) => (
                <button
                  key={x.m.pfid}
                  type="button"
                  aria-pressed={selected === i}
                  onClick={() => {
                    setSelected(i);
                  }}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </>
        )}
        {key === "B" && (
          <div className="hp-lead-grid">
            <Detail p={picks[0]} now={now} />
            <div className="hp-minis">
              {picks.slice(1).map((x) => (
                <Mini key={x.m.pfid} p={x} now={now} />
              ))}
            </div>
          </div>
        )}
        {key === "C" && (
          <div className="hp-cards">
            {picks.map((x) => (
              <article key={x.m.pfid} className="hp-discovery">
                <span className="hp-kicker">{x.label}</span>
                <Link href={mapHref(x.m.pfid)} className="hp-card-image">
                  <MapImage preview={x.m.preview} />
                </Link>
                <div className="hp-copy">
                  <h3>
                    <Link href={mapHref(x.m.pfid)}>{x.m.title}</Link>
                  </h3>
                  <span className="hp-by">by {x.m.creator}</span>
                  <Facts p={x} />
                  <PodLine p={x.m.top3[0]} i={0} />
                  <Link className="hp-more" href={mapHref(x.m.pfid)}>
                    Leaderboard &rarr;
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
        {key === "D" && (
          <div className="hp-selector">
            <div className="hp-reasons">
              {picks.map((x, i) => (
                <button
                  key={x.m.pfid}
                  type="button"
                  aria-pressed={selected === i}
                  onClick={() => {
                    setSelected(i);
                  }}
                >
                  <MapImage preview={x.m.preview} />
                  <span>
                    <b>{x.label}</b>
                    <small>{whyOf(x, now)}</small>
                  </span>
                  <span aria-hidden="true">&rarr;</span>
                </button>
              ))}
            </div>
            <Detail p={p} now={now} />
          </div>
        )}
        {key === "E" && (
          <div className="hp-digest">
            {picks.map((x) => (
              <article key={x.m.pfid} className="hp-digest-row">
                <Link className="hp-digest-image" href={mapHref(x.m.pfid)}>
                  <MapImage preview={x.m.preview} />
                </Link>
                <div className="hp-digest-title">
                  <span className="hp-kicker">{x.label}</span>
                  <h3>
                    <Link href={mapHref(x.m.pfid)}>{x.m.title}</Link>
                  </h3>
                  <span className="hp-by">by {x.m.creator}</span>
                </div>
                <Facts p={x} />
                <div className="hp-digest-leader">
                  <PodLine p={x.m.top3[0]} i={0} />
                  <Link className="hp-more" href={mapHref(x.m.pfid)}>
                    Leaderboard &rarr;
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {!framed && (
        <>
          {phone && (
            <div className="hp-phone-scrim">
              <iframe key={key} title="Phone preview" src={"/?" + frameQuery.toString()} />
            </div>
          )}
          <div
            ref={picker}
            className="hp-picker"
            role="region"
            aria-label="Prototype variant picker"
          >
            <span
              className="hp-drag"
              onPointerDown={(e) => {
                const el = picker.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                const startX = e.clientX,
                  startY = e.clientY;
                e.currentTarget.setPointerCapture(e.pointerId);
                const move = (event: PointerEvent) => {
                  el.style.insetInlineStart =
                    String(
                      Math.max(
                        0,
                        Math.min(
                          window.innerWidth - rect.width,
                          rect.left + event.clientX - startX,
                        ),
                      ),
                    ) + "px";
                  el.style.insetBlockStart =
                    String(
                      Math.max(
                        0,
                        Math.min(
                          window.innerHeight - rect.height,
                          rect.top + event.clientY - startY,
                        ),
                      ),
                    ) + "px";
                  el.style.insetInlineEnd = "auto";
                  el.style.insetBlockEnd = "auto";
                };
                const stop = () => {
                  window.removeEventListener("pointermove", move);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", stop, { once: true });
              }}
            >
              ⠿ PROTOTYPE · ROUND 1
            </span>
            <div className="hp-picker-controls">
              <button
                type="button"
                onClick={() => {
                  cycle(-1);
                }}
                aria-label="Previous variant"
              >
                ←
              </button>
              <strong>
                {key} · {variant.name}
              </strong>
              <button
                type="button"
                onClick={() => {
                  cycle(1);
                }}
                aria-label="Next variant"
              >
                →
              </button>
            </div>
            <p>{variant.note}</p>
            <div className="hp-picker-controls">
              {variants.map((v) => (
                <button
                  type="button"
                  key={v.key}
                  aria-pressed={key === v.key}
                  onClick={() => {
                    choose(v.key);
                  }}
                >
                  {v.key}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={!phone}
                onClick={() => {
                  setView(false);
                }}
              >
                Desktop
              </button>
              <button
                type="button"
                aria-pressed={phone}
                onClick={() => {
                  setView(true);
                }}
              >
                Phone
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
// END PROTOTYPE
