"use client";
// PROTOTYPE (grill-design, share images): the variant picker and the unfurl mock-ups.
import { useEffect, useState } from "react";

import { SAMPLES } from "./samples";

const VARIANTS = [
  ["1", "Bottom row", "Round 1's picks as they were: player B; Maps, Tracks and Dailies D with four tiles along the bottom over the picture."],
  ["2", "Split", "Picture as its own half on the left (a big avatar, or the screenshot full height), name and a 2x2 of tiles on the right."],
  ["3", "Banner", "Picture band across the top with the name on it, a solid band of tiles below. A player's band is their best finish's Map or Track, dimmed."],
  ["4", "Side column", "Tiles stacked in a column on the right; the name sits bottom-left (players: avatar top-left)."],
  ["5", "Inline", "No tile boxes: the numbers set in one line under the name. Drops the 'unofficial' footer line on players."],
] as const;

function param(k: string, fallback: string) {
  return new URLSearchParams(location.search).get(k) ?? fallback;
}

export function Proto() {
  const [v, setV] = useState("1");
  const [st, setSt] = useState("top");
  useEffect(() => {
    setV(param("variant", "1"));
    setSt(param("state", "top"));
  }, []);
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set("variant", v);
    u.searchParams.set("state", st);
    history.replaceState(history.state, "", u);
  }, [v, st]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const i = VARIANTS.findIndex((x) => x[0] === v);
      if (e.key === "ArrowRight") setV(VARIANTS[(i + 1) % VARIANTS.length][0]);
      if (e.key === "ArrowLeft") setV(VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length][0]);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [v]);
  const s = SAMPLES.find((x) => x.key === st) ?? SAMPLES[0];
  const src = `/og-proto/img/${v}/${s.kind}/${s.id}`;
  const cur = VARIANTS.find((x) => x[0] === v) ?? VARIANTS[0];
  const step = (d: number) => {
    const i = VARIANTS.findIndex((x) => x[0] === v);
    setV(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0]);
  };
  return (
    <main style={{ padding: "24px 16px 160px", maxWidth: 1240, margin: "0 auto", color: "#eaf0ff", fontFamily: "Chakra Petch, sans-serif" }}>
      <h1 style={{ fontFamily: "Bungee", fontSize: 22, margin: "0 0 4px" }}>Share images · round 2</h1>
      <p style={{ color: "#93a2c8", margin: "0 0 20px" }}>
        What a link to <a style={{ color: "#8be03c" }} href={s.path}>{s.path}</a> would unfurl as.{" "}
        <a style={{ color: "#8be03c" }} href={`/og-proto/share/${v}/${s.kind}/${s.id}`}>Shareable test link</a>{" "}
        (paste it in Discord to see a real unfurl of this variant).
      </p>
      <section style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
        <figure style={{ margin: 0 }}>
          <figcaption style={{ color: "#93a2c8", fontSize: 13, marginBottom: 6 }}>Discord, at its size</figcaption>
          <div style={{ background: "#313338", padding: 16, borderRadius: 8, width: 464, fontFamily: "system-ui, sans-serif" }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 40, background: "#5865f2", flex: "none" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#f2f3f5", fontWeight: 600, fontSize: 15 }}>someone <span style={{ color: "#949ba4", fontWeight: 400, fontSize: 12 }}>Today at 4:20 PM</span></div>
                <div style={{ color: "#00a8fc", fontSize: 15, overflowWrap: "anywhere" }}>https://ballestrecords.com{s.path}</div>
                <div style={{ marginTop: 6, background: "#2b2d31", borderLeft: "4px solid #8be03c", borderRadius: 4, padding: "8px 16px 16px 12px", maxWidth: 432 }}>
                  <div style={{ color: "#dbdee1", fontSize: 12, margin: "4px 0" }}>ballestrecords.com</div>
                  <div style={{ color: "#00a8fc", fontWeight: 600, fontSize: 16 }}>Page title · Ballest of Them All</div>
                  <div style={{ color: "#dbdee1", fontSize: 14, margin: "6px 0 12px" }}>The page&apos;s description, as now.</div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
                  <img key={src} src={src} alt="" style={{ width: 400, borderRadius: 4, display: "block" }} />
                </div>
              </div>
            </div>
          </div>
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption style={{ color: "#93a2c8", fontSize: 13, marginBottom: 6 }}>iMessage / Slack small</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
          <img key={src + "s"} src={src} alt="" style={{ width: 260, borderRadius: 14, display: "block" }} />
        </figure>
      </section>
      <figure style={{ margin: "32px 0 0" }}>
        <figcaption style={{ color: "#93a2c8", fontSize: 13, marginBottom: 6 }}>Full size, 1200 × 630</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
        <img key={src + "f"} src={src} alt="" style={{ width: "100%", maxWidth: 1200, display: "block", borderRadius: 8 }} />
      </figure>
      <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 9999, background: "#fff", color: "#000", borderRadius: 16, padding: "10px 12px", boxShadow: "0 6px 24px rgba(0,0,0,.6)", fontFamily: "system-ui, sans-serif", fontSize: 14, maxWidth: "calc(100vw - 32px)", width: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => step(-1)} aria-label="Previous variant">←</button>
          <strong style={{ flex: 1, textAlign: "center" }}>PROTOTYPE · {cur[0]} · {cur[1]}</strong>
          <button onClick={() => step(1)} aria-label="Next variant">→</button>
        </div>
        <div style={{ fontSize: 12, margin: "6px 0", color: "#333" }}>{cur[2]}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {SAMPLES.map((x) => (
            <button key={x.key} onClick={() => setSt(x.key)} style={{ fontWeight: x.key === st ? 700 : 400, background: x.key === st ? "#8be03c" : "#eee", border: 0, borderRadius: 8, padding: "3px 8px" }}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
