"use client";
// PROTOTYPE — round 2: D's map selector, five recent-discovery policies.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMounted } from "../../hooks/client";
import { MapImage } from "../MapImage";
import { CreatorLink, PodLine } from "../workshop/Card";
import { mapHref } from "../../lib/routes";
import { ageText, fmtN, fmtTime } from "../../lib/rules";
import {
  DISCOVERY_POLICIES,
  discoveryPicks,
  type DiscoveryKey,
  type HomeActivity,
} from "../../lib/discovery";
import { recordOf, type MapCard } from "../../lib/workshop";

export function HomePrototype({
  maps,
  activity,
  now,
}: {
  maps: ReadonlyArray<MapCard>;
  activity: HomeActivity;
  now: number;
}) {
  const mounted = useMounted();
  const params = useSearchParams();
  const initial = params.get("variant") ?? "E";
  const [key, setKey] = useState<DiscoveryKey>(
    DISCOVERY_POLICIES.find((p) => p.key === initial)?.key ?? "E",
  );
  const [phone, setPhone] = useState(params.get("view") === "phone");
  const [selected, setSelected] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const variant = DISCOVERY_POLICIES.find((p) => p.key === key) ?? DISCOVERY_POLICIES[4];
  const framed = params.get("framed") === "1";
  const choose = (next: DiscoveryKey) => {
    setKey(next);
    setSelected(0);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  };
  const cycle = (delta: number) =>
    choose(DISCOVERY_POLICIES[(DISCOVERY_POLICIES.indexOf(variant) + delta + 5) % 5].key);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches("input,textarea,select") || e.target.isContentEditable)
      )
        return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const index = DISCOVERY_POLICIES.findIndex((p) => p.key === key);
      const next = DISCOVERY_POLICIES[(index + (e.key === "ArrowRight" ? 1 : -1) + 5) % 5].key;
      setKey(next);
      setSelected(0);
      const url = new URL(window.location.href);
      url.searchParams.set("variant", next);
      window.history.replaceState(null, "", url);
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
  const picks = discoveryPicks(maps, activity, key, now);
  const pick = (picks[selected] ?? picks[0]) as (typeof picks)[number] | undefined;
  const shortPolicy = {
    A: "Published in the last 30 days · most reported sessions over 7 days",
    B: "Published in the last 14 days · most reported sessions over 24 hours",
    C: "Published in the last 7 days · most reported sessions since publication",
    D: "Newest first · at least 5 players with a time",
    E: "Recent Maps · five different picks each day, when the pool allows",
  }[key];
  const activityDate = activity.asOf ? new Date(activity.asOf).toISOString().slice(0, 10) : null;
  return (
    <>
      <section
        className="hp-feature hp-D hp-round2"
        data-hydrated={mounted}
        aria-label="Discover recent Workshop maps"
      >
        <div className="hp-heading">
          <span className="hp-kicker">{variant.title}</span>
          <span>{shortPolicy}</span>
        </div>
        {pick ? (
          <div className="hp-selector">
            <div className="hp-reasons" aria-label="Map picks">
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
                    <b>{x.m.title}</b>
                    <small>
                      by {x.m.creator} · {ageText(x.m.created, now)}
                    </small>
                  </span>
                  <span aria-hidden="true">&rarr;</span>
                </button>
              ))}
            </div>
            <article className="hp-detail">
              <div className="hp-picture">
                <MapImage preview={pick.m.preview} />
              </div>
              <div className="hp-copy">
                <span className="hp-kicker">Published {ageText(pick.m.created, now)}</span>
                <h2>{pick.m.title}</h2>
                <span className="hp-by">
                  by <CreatorLink m={pick.m} />
                </span>
                <div className="hp-facts">
                  <span>
                    <b>{fmtN(pick.m.entryCount)}</b>players with a time
                  </span>
                  <span>
                    <b>{fmtTime(recordOf(pick.m))}</b>world record
                  </span>
                  <span>
                    <b>{pick.recent == null ? "—" : fmtN(pick.recent)}</b>
                    {pick.recent == null
                      ? "recent sessions unavailable"
                      : "reported sessions / " + pick.period}
                  </span>
                </div>
                {pick.fallback && (
                  <p className="hp-fallback">
                    New release pick · not enough reported recent activity to rank.
                  </p>
                )}
                <div className="hp-podium">
                  {pick.m.top3.map((p, i) => (
                    <PodLine key={i} p={p} i={i} />
                  ))}
                </div>
                <Link className="go" href={mapHref(pick.m.pfid)}>
                  View leaderboard &rarr;
                </Link>
              </div>
            </article>
          </div>
        ) : (
          <div className="empty">
            <b>No eligible recent Maps yet.</b>
            <p>New Maps will appear after a Refresh finds their times.</p>
          </div>
        )}
        <p className="hp-activity-note">
          {activityDate
            ? "Activity through the latest Refresh · " + activityDate
            : "Recent activity is unavailable."}
          {key === "E" ? " · Daily picks change at 00:00 UTC." : ""} Steam's reported session counts
          may omit some play sessions.
        </p>
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
                const rect = el.getBoundingClientRect(),
                  startX = e.clientX,
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
              ⠿ PROTOTYPE · ROUND 2 · D LAYOUT
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
              {DISCOVERY_POLICIES.map((v) => (
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
