// ================================================================ PROTOTYPE (report movement)
// Throwaway: draws the Daily Report standings image in five ways of showing what moved since
// yesterday (rank up or down, and the +/- on each number), for each state of the day.
//   node --import tsx scripts/prototype-movement.ts [outDir]
// Never merged; the winner is rebuilt in src/.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { svgUri } from "../src/render/art.js";
import { Renderer } from "../src/render/renderer.js";
import { backdrop, box, C, type El, F, img, label } from "../src/render/scenes.js";

// ---------------------------------------------------------------- data

interface Row {
  readonly name: string;
  readonly n: number;
  /** Rank yesterday, or null when the player was not in yesterday's top 10. */
  readonly was: number | null;
  /** n today minus n yesterday. */
  readonly delta: number;
}
interface Board {
  readonly title: string;
  readonly rows: ReadonlyArray<Row>;
  /** Players in yesterday's top 10 who are not in today's. */
  readonly out: ReadonlyArray<string>;
}
interface Day {
  readonly title: string;
  readonly subtitle: string;
  readonly boards: ReadonlyArray<Board>;
  /** False on the first report, or a board first read today: no yesterday to compare with. */
  readonly hasYesterday: boolean;
}

const r = (name: string, n: number, was: number | null, delta = 0): Row => ({
  name,
  n,
  was,
  delta,
});

const busy: Day = {
  title: "Saturday 10 October",
  subtitle: "Workshop standings · 1,286 Workshop Maps · 4,778 players",
  hasYesterday: true,
  boards: [
    {
      title: "Most Maps played",
      rows: [
        r("Slati Jnr", 999, 1, 14),
        r("Chaos", 462, 2, 3),
        r("Pamzei", 304, 3, 0),
        r("Ronko Tomyno", 291, 5, 19),
        r("SlugSalt", 277, 4, 0),
        r("[:D:] CryT4x", 268, 6, 2),
        r("R23", 251, 7, 0),
        r("nuts", 248, null, 31),
        r("ChknThugget", 242, 8, 1),
        r("Action Jackson", 237, 9, 0),
      ],
      out: ["Low5ive"],
    },
    {
      title: "Most Author Medals",
      rows: [
        r("Slati Jnr", 979, 1, 12),
        r("Chaos", 414, 2, 2),
        r("Pamzei", 280, 3, 0),
        r("Ronko Tomyno", 235, 5, 9),
        r("[:D:] CryT4x", 234, 4, 1),
        r("SlugSalt", 207, 6, 0),
        r("Action Jackson", 206, 8, 4),
        r("Bill Lumbergh", 201, 7, 0),
        r("123JLaney123", 199, 9, 1),
        r("ChknThugget", 190, 10, 0),
      ],
      out: [],
    },
    {
      title: "Most world records",
      rows: [
        r("Slati Jnr", 169, 1, 5),
        r("123JLaney123", 100, 2, -2),
        r("Pamzei", 78, 3, 0),
        r("alepa", 65, 4, 1),
        r("Chaos", 56, 5, -1),
        r("Bill Lumbergh", 34, 6, 0),
        r("snayK", 28, 8, 3),
        r("Skylar <3", 26, 7, -1),
        r("Vulpathy", 18, null, 4),
        r("purple", 18, 9, 0),
      ],
      out: ["Low5ive"],
    },
    {
      title: "Most top 5s",
      rows: [
        r("Slati Jnr", 608, 1, 9),
        r("Chaos", 243, 2, 0),
        r("Pamzei", 207, 3, -1),
        r("123JLaney123", 181, 4, 2),
        r("Bill Lumbergh", 150, 6, 6),
        r("alepa", 140, 5, -2),
        r("Action Jackson", 107, 7, 1),
        r("[:D:] CryT4x", 83, 9, 4),
        r("Low5ive", 77, 8, -3),
        r("nuts", 71, null, 11),
      ],
      out: ["purple"],
    },
  ],
};

const quiet: Day = {
  ...busy,
  title: "Sunday 11 October",
  boards: busy.boards.map((b) => ({
    ...b,
    out: [],
    rows: b.rows.map((row, i) => ({ ...row, was: i + 1, delta: i === 1 ? 1 : 0 })),
  })),
};

const first: Day = {
  ...busy,
  hasYesterday: false,
  boards: busy.boards.map((b) => ({
    ...b,
    out: [],
    rows: b.rows.map((row) => ({ ...row, was: null, delta: 0 })),
  })),
};

const DAYS = { busy, quiet, first } as const;

// ---------------------------------------------------------------- shared bits

const UP = "#8be03c";
const DOWN = "#ff6b6b";
const NAME = 20;
const clip = (name: string, max = NAME) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

/** Places moved: positive is up. Null when new to the top 10. */
const moved = (row: Row, rank: number) => (row.was === null ? null : row.was - rank);

const header = (day: Day) =>
  box(
    { flexDirection: "column", gap: 4 },
    box({ fontFamily: F.marquee, fontSize: 28 }, day.title),
    box({ color: C.dim, fontSize: 14 }, day.subtitle),
  );

const grid = (day: Day, column: (b: Board) => El, extra: ReadonlyArray<El | null> = []) => {
  const cols = day.boards.map(column);
  return backdrop(
    { padding: 28, gap: 20 },
    header(day),
    box({ gap: 24 }, ...cols.slice(0, 2)),
    box({ gap: 24 }, ...cols.slice(2, 4)),
    ...extra,
  );
};

const rankBox = (i: number, width = 22) =>
  box(
    { width, color: i < 3 ? C.gold : C.faint, fontFamily: F.hud, fontWeight: 700 },
    String(i + 1),
  );

const rowBox = (i: number, style: Record<string, string | number>, ...children: Array<El | null>) =>
  box(
    {
      alignItems: "center",
      gap: 8,
      fontSize: 15,
      padding: "3px 8px",
      borderRadius: 6,
      backgroundColor: i === 0 ? "rgba(139,224,60,0.16)" : C.surface,
      ...style,
    },
    ...children,
  );

const hud = (text: string, style: Record<string, string | number> = {}) =>
  box({ fontFamily: F.hud, fontWeight: 700, ...style }, text);

const triangle = (up: boolean, size = 8) =>
  img(
    svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 10 10"><path d="${up ? "M5 1L9.5 9H0.5Z" : "M5 9L9.5 1H0.5Z"}" fill="${up ? UP : DOWN}"/></svg>`,
    ),
    size,
    size,
  );

// ---------------------------------------------------------------- A: tags

/** A: the current rows, with a small ▲2 / ▼1 after the rank and a +3 after the number. */
const tags = (day: Day) =>
  grid(day, (b) =>
    box(
      { flexDirection: "column", width: 270, gap: 4 },
      label(b.title, { fontSize: 13, letterSpacing: 1.4, marginBottom: 6 }),
      ...b.rows.map((row, i) => {
        const m = day.hasYesterday ? moved(row, i + 1) : 0;
        return rowBox(
          i,
          {},
          rankBox(i, 18),
          box(
            { width: 26, alignItems: "center", gap: 2, fontSize: 11 },
            m === null
              ? hud("NEW", { fontSize: 9, color: UP, letterSpacing: 0.5 })
              : m === 0
                ? null
                : box(
                    { alignItems: "center", gap: 2, color: m > 0 ? UP : DOWN },
                    triangle(m > 0, 7),
                    hud(String(Math.abs(m)), { fontSize: 11 }),
                  ),
          ),
          box({ flexGrow: 1, overflow: "hidden" }, clip(row.name, 18)),
          row.delta !== 0 && day.hasYesterday
            ? hud(`${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)}`, {
                fontSize: 11,
                color: row.delta > 0 ? UP : DOWN,
              })
            : null,
          hud(String(row.n)),
        );
      }),
    ),
  );

// ---------------------------------------------------------------- B: ledger

/** B: a fixed column for each: movement as a coloured edge and arrow, then n, then Δ. */
const ledger = (day: Day) =>
  grid(day, (b) =>
    box(
      { flexDirection: "column", width: 270, gap: 4 },
      box(
        { alignItems: "flex-end", marginBottom: 6 },
        label(b.title, { fontSize: 13, letterSpacing: 1.4, flexGrow: 1 }),
        label("+/− day", { fontSize: 9, color: C.faint, width: 44, justifyContent: "flex-end" }),
      ),
      ...b.rows.map((row, i) => {
        const m = day.hasYesterday ? moved(row, i + 1) : 0;
        const edge = m === null || (m ?? 0) > 0 ? UP : (m ?? 0) < 0 ? DOWN : "transparent";
        return rowBox(
          i,
          { borderLeft: `3px solid ${edge}`, paddingLeft: 6, gap: 6 },
          rankBox(i, 20),
          box(
            { width: 12, justifyContent: "center" },
            m === null ? triangle(true, 8) : m === 0 ? null : triangle(m > 0, 8),
          ),
          box({ flexGrow: 1, overflow: "hidden" }, clip(row.name, 17)),
          hud(String(row.n)),
          box(
            { width: 34, justifyContent: "flex-end" },
            !day.hasYesterday
              ? null
              : hud(row.delta === 0 ? "·" : `${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)}`, {
                  fontSize: 13,
                  color: row.delta > 0 ? UP : row.delta < 0 ? DOWN : C.faint,
                }),
          ),
        );
      }),
    ),
  );

// ---------------------------------------------------------------- C: was → now

/** C: spelled out: yesterday's rank struck before today's, and "296 (+12)". */
const spelled = (day: Day) =>
  grid(day, (b) =>
    box(
      { flexDirection: "column", width: 270, gap: 4 },
      label(b.title, { fontSize: 13, letterSpacing: 1.4, marginBottom: 6 }),
      ...b.rows.map((row, i) => {
        const m = day.hasYesterday ? moved(row, i + 1) : 0;
        return rowBox(
          i,
          {},
          box(
            { width: 40, alignItems: "baseline", gap: 3 },
            m !== 0
              ? hud(m === null ? "–" : String(row.was), {
                  fontSize: 11,
                  color: C.faint,
                  textDecoration: m === null ? "none" : "line-through",
                })
              : null,
            hud(String(i + 1), { color: i < 3 ? C.gold : m ? (m > 0 ? UP : DOWN) : C.faint }),
          ),
          box({ flexGrow: 1, overflow: "hidden" }, clip(row.name, 16)),
          box(
            { alignItems: "baseline", gap: 3 },
            hud(String(row.n)),
            row.delta !== 0 && day.hasYesterday
              ? hud(`(${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)})`, {
                  fontSize: 11,
                  color: C.dim,
                })
              : null,
          ),
        );
      }),
    ),
  );

// ---------------------------------------------------------------- D: slopes

const ROW_H = 24;
const GAP = 4;
const SLOPE_W = 30;

/** D: each board is a small bump chart: a line from yesterday's place to today's. */
const slopes = (day: Day) =>
  grid(day, (b) => {
    const y = (rank: number) => (rank - 1) * (ROW_H + GAP) + ROW_H / 2;
    const h = b.rows.length * (ROW_H + GAP);
    const lines = !day.hasYesterday
      ? ""
      : b.rows
          .map((row, i) => {
            const m = moved(row, i + 1);
            const from = row.was === null ? h + 6 : y(row.was);
            const to = y(i + 1);
            const colour = m === null || m > 0 ? UP : m < 0 ? DOWN : "rgba(150,175,245,0.28)";
            const width = m === 0 ? 1 : 2;
            return `<circle cx="3" cy="${from}" r="${m === null ? 0 : 2.5}" fill="${colour}"/><path d="M3 ${from} C ${SLOPE_W / 2} ${from}, ${SLOPE_W / 2} ${to}, ${SLOPE_W} ${to}" stroke="${colour}" stroke-width="${width}" fill="none"/>`;
          })
          .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLOPE_W}" height="${h + 10}">${lines}</svg>`;
    return box(
      { flexDirection: "column", width: 270 },
      box(
        { alignItems: "flex-end", marginBottom: 10 },
        label(day.hasYesterday ? "Yday" : "", {
          fontSize: 8,
          width: SLOPE_W + 4,
          color: C.faint,
          letterSpacing: 0.6,
        }),
        label(b.title, { fontSize: 13, letterSpacing: 1.4 }),
      ),
      box(
        {},
        box({ width: SLOPE_W + 4 }, img(svgUri(svg), SLOPE_W, h + 10)),
        box(
          { flexDirection: "column", gap: GAP, flexGrow: 1 },
          ...b.rows.map((row, i) =>
            rowBox(
              i,
              { height: ROW_H, padding: "0 8px" },
              rankBox(i, 20),
              box({ flexGrow: 1, overflow: "hidden" }, clip(row.name, 17)),
              row.delta > 0 && day.hasYesterday
                ? hud(`+${row.delta}`, { fontSize: 11, color: UP })
                : row.delta < 0 && day.hasYesterday
                  ? hud(`−${-row.delta}`, { fontSize: 11, color: DOWN })
                  : null,
              hud(String(row.n)),
            ),
          ),
        ),
      ),
      b.out.length > 0 && day.hasYesterday
        ? box(
            { fontSize: 11, color: C.faint, marginTop: 0, paddingLeft: SLOPE_W + 12 },
            `Out: ${b.out.join(", ")}`,
          )
        : null,
    );
  });

// ---------------------------------------------------------------- E: heat

/** E: rows tinted by how they moved; NEW pill for entrants; Δ as a superscript; who fell out. */
const heat = (day: Day) =>
  grid(
    day,
    (b) =>
      box(
        { flexDirection: "column", width: 270, gap: 4 },
        label(b.title, { fontSize: 13, letterSpacing: 1.4, marginBottom: 6 }),
        ...b.rows.map((row, i) => {
          const m = day.hasYesterday ? moved(row, i + 1) : 0;
          const tint =
            m === null
              ? "rgba(88,168,255,0.20)"
              : m > 0
                ? `rgba(139,224,60,${Math.min(0.1 + m * 0.07, 0.32)})`
                : m < 0
                  ? `rgba(255,107,107,${Math.min(0.1 - m * 0.07, 0.3)})`
                  : C.surface;
          return rowBox(
            i,
            { backgroundColor: tint },
            rankBox(i),
            box({ flexGrow: 1, overflow: "hidden", alignItems: "center", gap: 6 }, clip(row.name, 16),
              m === null
                ? hud("NEW", {
                    fontSize: 8,
                    letterSpacing: 0.8,
                    color: "#0a1020",
                    backgroundColor: "#58a8ff",
                    padding: "1px 4px",
                    borderRadius: 3,
                  })
                : null,
            ),
            box(
              { alignItems: "flex-start" },
              hud(String(row.n)),
              row.delta !== 0 && day.hasYesterday
                ? hud(`${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)}`, {
                    fontSize: 9,
                    marginLeft: 2,
                    marginTop: -3,
                    color: row.delta > 0 ? UP : DOWN,
                  })
                : null,
            ),
          );
        }),
        b.out.length > 0 && day.hasYesterday
          ? box(
              { fontSize: 11, color: C.faint, padding: "2px 8px" },
              `↓ out of the top 10: ${b.out.join(", ")}`,
            )
          : null,
      ),
    [
      day.hasYesterday
        ? box(
            { gap: 14, fontSize: 11, color: C.faint, alignItems: "center" },
            box({ width: 10, height: 10, borderRadius: 2, backgroundColor: "rgba(139,224,60,0.3)" }),
            "climbed",
            box({ width: 10, height: 10, borderRadius: 2, backgroundColor: "rgba(255,107,107,0.3)" }),
            "fell",
            box({ width: 10, height: 10, borderRadius: 2, backgroundColor: "rgba(88,168,255,0.3)" }),
            "new to the top 10",
            box({ marginLeft: 8 }, "small number: change since yesterday"),
          )
        : null,
    ],
  );


// ---------------------------------------------------------------- round 2: takes on A

interface TagStyle {
  readonly move: "arrowNum" | "pill" | "arrowOnly";
  readonly movePos: "afterRank" | "end";
  readonly delta: "colour" | "pill" | "dim" | "super";
  readonly fresh: "text" | "pill" | "dot";
}

const sign = (d: number) => `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
const tint = (up: boolean, a: number) => (up ? `rgba(139,224,60,${a})` : `rgba(255,107,107,${a})`);
const BLUE = "#58a8ff";

const freshTag = (t: TagStyle) =>
  t.fresh === "pill"
    ? hud("NEW", {
        fontSize: 8,
        letterSpacing: 0.6,
        color: "#0a1020",
        backgroundColor: BLUE,
        padding: "1px 3px",
        borderRadius: 3,
      })
    : t.fresh === "dot"
      ? box({ width: 7, height: 7, borderRadius: 4, backgroundColor: BLUE })
      : hud("NEW", { fontSize: 9, color: BLUE, letterSpacing: 0.5 });

const moveTag = (t: TagStyle, m: number | null) => {
  if (m === null) return freshTag(t);
  if (m === 0) return null;
  const up = m > 0;
  if (t.move === "arrowOnly") return triangle(up, 8);
  if (t.move === "pill")
    return box(
      {
        alignItems: "center",
        gap: 2,
        padding: "1px 4px",
        borderRadius: 4,
        backgroundColor: tint(up, 0.18),
        color: up ? UP : DOWN,
      },
      triangle(up, 6),
      hud(String(Math.abs(m)), { fontSize: 10 }),
    );
  return box(
    { alignItems: "center", gap: 2, color: up ? UP : DOWN },
    triangle(up, 7),
    hud(String(Math.abs(m)), { fontSize: 11 }),
  );
};

const number = (t: TagStyle, row: Row, show: boolean) => {
  const d = show ? row.delta : 0;
  const n = hud(String(row.n));
  if (d === 0) return n;
  const colour = d > 0 ? UP : DOWN;
  if (t.delta === "super")
    return box(
      { alignItems: "flex-start" },
      n,
      hud(sign(d), { fontSize: 9, marginLeft: 2, marginTop: -3, color: colour }),
    );
  const tag =
    t.delta === "pill"
      ? hud(sign(d), {
          fontSize: 10,
          color: colour,
          backgroundColor: tint(d > 0, 0.16),
          padding: "1px 4px",
          borderRadius: 4,
        })
      : hud(sign(d), { fontSize: 11, color: t.delta === "dim" ? C.faint : colour });
  return box({ alignItems: "center", gap: 6 }, tag, n);
};

type OutStyle = "none" | "line" | "row" | "footer" | "header";

const outPill = (text: string) =>
  box(
    {
      alignItems: "center",
      gap: 3,
      padding: "1px 5px",
      borderRadius: 4,
      backgroundColor: tint(false, 0.18),
      color: DOWN,
    },
    triangle(false, 6),
    hud(text, { fontSize: 10 }),
  );

const tagged =
  (t: TagStyle, out: OutStyle = "none") =>
  (day: Day) => {
    const showOut = (b: Board) => day.hasYesterday && b.out.length > 0;
    const footerNames = day.boards.flatMap((b) =>
      showOut(b) ? b.out.map((name) => `${name} (${b.title.replace("Most ", "")})`) : [],
    );
    return grid(
      day,
      (b) =>
        box(
          { flexDirection: "column", width: 270, gap: 4 },
          box(
            { alignItems: "center", marginBottom: 6, gap: 6 },
            label(b.title, { fontSize: 13, letterSpacing: 1.4, flexGrow: 1 }),
            out === "header" && showOut(b) ? outPill(b.out.join(", ")) : null,
          ),
          ...b.rows.map((row, i) => {
            const m = day.hasYesterday ? moved(row, i + 1) : 0;
            const slot = (width: number, justify: string) =>
              box({ width, alignItems: "center", justifyContent: justify }, moveTag(t, m));
            return rowBox(
              i,
              {},
              rankBox(i, 18),
              t.movePos === "afterRank"
                ? slot(t.move === "arrowOnly" ? 12 : 30, "flex-start")
                : null,
              box({ flexGrow: 1, overflow: "hidden" }, clip(row.name, 17)),
              number(t, row, day.hasYesterday),
              t.movePos === "end" ? slot(28, "flex-end") : null,
            );
          }),
          out === "line" && showOut(b)
            ? box(
                { fontSize: 11, color: C.faint, padding: "2px 8px" },
                `Out of the top 10: ${b.out.join(", ")}`,
              )
            : null,
          ...(out === "row" && showOut(b)
            ? b.out.map((name) =>
                rowBox(
                  9,
                  { backgroundColor: "transparent", border: `1px dashed ${C.line}`, opacity: 0.75 },
                  hud("–", { width: 18, color: C.faint }),
                  box({ width: 46 }, outPill("OUT")),
                  box({ flexGrow: 1, color: C.dim }, clip(name, 17)),
                ),
              )
            : []),
        ),
      [
        out === "footer" && footerNames.length > 0
          ? box(
              { alignItems: "center", gap: 8, fontSize: 12, color: C.dim },
              outPill("OUT"),
              `Dropped out of the top 10: ${footerNames.join(" · ")}`,
            )
          : null,
      ],
    );
  };

const ROUND2 = {
  "r2-1-baseline": tagged({ move: "arrowNum", movePos: "afterRank", delta: "colour", fresh: "text" }),
  "r2-2-pills": tagged({ move: "pill", movePos: "afterRank", delta: "pill", fresh: "pill" }),
  "r2-3-quiet": tagged({ move: "arrowOnly", movePos: "afterRank", delta: "dim", fresh: "dot" }),
  "r2-4-right-edge": tagged({ move: "arrowNum", movePos: "end", delta: "colour", fresh: "text" }),
  "r2-5-superscript": tagged({ move: "arrowNum", movePos: "afterRank", delta: "super", fresh: "pill" }),
} as const;

const PILLS: TagStyle = { move: "pill", movePos: "afterRank", delta: "pill", fresh: "pill" };
const ROUND3 = {
  "r3-1-leave-out": tagged(PILLS, "none"),
  "r3-2-line": tagged(PILLS, "line"),
  "r3-3-ghost-row": tagged(PILLS, "row"),
  "r3-4-footer": tagged(PILLS, "footer"),
  "r3-5-header": tagged(PILLS, "header"),
} as const;

// ---------------------------------------------------------------- run

const VARIANTS = { "a-tags": tags, "b-ledger": ledger, "c-spelled": spelled, "d-slopes": slopes, "e-heat": heat } as const;

const out = process.argv[2] ?? ".logs/movement";
const program = Effect.gen(function* () {
  const renderer = yield* Renderer;
  yield* Effect.tryPromise(() => mkdir(out, { recursive: true }));
  for (const [v, scene] of Object.entries(ROUND3))
    for (const [d, day] of Object.entries(DAYS)) {
      const png = yield* renderer.scene(scene(day), 620);
      yield* Effect.tryPromise(() => writeFile(join(out, `${v}--${d}.png`), png));
    }
  yield* Effect.log(`wrote variants to ${out}`);
});

program.pipe(Effect.provide(Renderer.Default), NodeRuntime.runMain);
