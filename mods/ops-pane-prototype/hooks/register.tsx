// PROTOTYPE: the ops pane grill-design (round 1: the pane's overall structure). Five variants
// over fixed fixtures; the picker row at the top cycles variants (p / n) and states (1-4).
// Never merged: the winner is rebuilt properly.
import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";

import { STATES, fixture } from "./fixtures";
import type { Health, Ops } from "./fixtures";

const PANE = "ops";
const VARIANTS = [
  { key: "A", name: "Ledger", blurb: "every system as a block of label / value rows" },
  {
    key: "B",
    name: "Timeline",
    blurb: "one list in time order, past above a now line, coming up below",
  },
  { key: "C", name: "Tiles", blurb: "one bordered tile per system, two across when wide" },
  {
    key: "D",
    name: "Needs you",
    blurb: "problems first, then one line per system, then what comes next",
  },
  { key: "E", name: "Tabs", blurb: "one system at a time, in depth, with its recent log" },
] as const;

const variant = atom({ plugin: "ops-pane-prototype", key: "variant" } as const, 0);
const stateIx = atom({ plugin: "ops-pane-prototype", key: "state" } as const, 0);
const tab = atom({ plugin: "ops-pane-prototype", key: "tab" } as const, 0);

// Central time: CDT (UTC-5) until 2026-11-01
const ct = (iso: string) => {
  const d = new Date(Date.parse(iso) - 5 * 3600_000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
};
const span = (ms: number) => {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h ${min % 60}m` : `${Math.round(h / 24)}d`;
};
const ago = (o: Ops, iso: string) => `${span(Date.parse(o.now) - Date.parse(iso))} ago`;
const until = (o: Ops, iso: string) => `in ${span(Date.parse(iso) - Date.parse(o.now))}`;
const dot = (h: Health) => (h === "ok" ? "●" : h === "warn" ? "◐" : "✕");
const tone = (h: Health) => (h === "ok" ? "success" : h === "warn" ? "warning" : "error");
const worst = (...hs: Health[]): Health =>
  hs.includes("bad") ? "bad" : hs.includes("warn") ? "warn" : "ok";

type System = { name: string; health: Health; headline: string; rows: [string, string][] };

function systems(o: Ops): System[] {
  const c = o.collector;
  const failed = c.lastRefresh.failed;
  const prHealth = worst(...o.prs.map((p) => p.health));
  return [
    {
      name: "Collector",
      health: c.health,
      headline:
        c.health === "bad"
          ? c.note
          : `Refresh ${ago(o, c.lastRefresh.at)}${failed.length ? `, ${failed.length} failed` : ""}`,
      rows: [
        ["Machine", c.machine],
        [
          "Last Refresh",
          `${ct(c.lastRefresh.at)} · ${c.lastRefresh.boards} boards · ${failed.length ? `failed: ${failed.join(", ")}` : "0 failed"}`,
        ],
        ["Next slot", `${ct(c.nextSlot)} (${until(o, c.nextSlot)})`],
        ["Running", c.job],
      ],
    },
    {
      name: "Daily",
      health: o.daily.health,
      headline: `read ${ago(o, o.daily.lastRead)} · ${o.daily.rows} runs`,
      rows: [
        ["Board", o.daily.board],
        ["Last read", `${ct(o.daily.lastRead)} · ${o.daily.rows} runs`],
        ["Closes", `${ct(o.daily.closes)} (${until(o, o.daily.closes)})`],
      ],
    },
    {
      name: "Multiballs",
      health: o.bot.health,
      headline: `${o.bot.machines} machine · Report ${until(o, o.bot.nextReport)}`,
      rows: [
        ["Machines", `${o.bot.machines} started`],
        ["Deployed", ago(o, o.bot.deployedAt)],
        ["Daily Report", `${ct(o.bot.nextReport)} (${until(o, o.bot.nextReport)})`],
      ],
    },
    {
      name: "Site",
      health: o.site.health,
      headline: `prod ${o.site.sha} · ${ago(o, o.site.prodAt)}`,
      rows: [
        ["Production", `${o.site.sha} · ${ago(o, o.site.prodAt)}`],
        ["", o.site.message],
        ...o.site.previews.map((p): [string, string] => [
          "Preview",
          `${p.branch} · ${p.state} · ${ago(o, p.at)}`,
        ]),
      ],
    },
    {
      name: "Pull requests",
      health: prHealth,
      headline: `${o.prs.length} open · ${o.prs.filter((p) => p.health !== "ok").length || "none"} red`,
      rows: o.prs.map((p): [string, string] => [
        `#${p.n}`,
        `${dot(p.health)} ${p.checks}${p.draft ? " · draft" : ""} · ${p.title}`,
      ]),
    },
  ];
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "ops", description: "PROTOTYPE: the Ballest ops pane" });
    void $.ui.open({ id: PANE, title: "Ballest ops · PROTOTYPE" });
    return next(e);
  });

  on("command.run", { command: "ops" }, async ($) => {
    await $.ui.open({ id: PANE, title: "Ballest ops · PROTOTYPE" });
    return { text: "Opened the ops pane prototype. p / n change the variant, 1-4 the state." };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const v = await read($, variant);
    const s = await read($, stateIx);
    const t = await read($, tab);
    const o = fixture(STATES[s] ?? "good");
    const sys = systems(o);
    const cols = e.props.bodyColumns;
    const wide = cols >= 70;
    const V = VARIANTS[v] ?? VARIANTS[0];

    const kv = (rows: [string, string][], width = 13) =>
      rows.map(([k, val]) => (
        <Box flexDirection="row">
          <Box width={width} flexShrink={0}>
            <Text dimColor>{k}</Text>
          </Box>
          <Box flexShrink={1}>
            <Text wrap="wrap">{val}</Text>
          </Box>
        </Box>
      ));
    const head = (x: System) => (
      <Text>
        <Text color={tone(x.health)}>{dot(x.health)} </Text>
        <Text bold>{x.name}</Text>
      </Text>
    );

    // PROTOTYPE picker: plainly not part of the design
    const picker = (
      <Box flexDirection="column" borderStyle="double" borderColor="claude" paddingX={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text color="claude" bold>
            PROTOTYPE
          </Text>
          <Button
            key="prev"
            plain
            hotkey="p"
            onPress={() => update($, variant, (x) => (x + 4) % 5)}
          >
            ‹
          </Button>
          <Text bold>
            {V.key} · {V.name}
          </Text>
          <Button
            key="next"
            plain
            hotkey="n"
            onPress={() => update($, variant, (x) => (x + 1) % 5)}
          >
            ›
          </Button>
        </Box>
        <Text dimColor wrap="wrap">
          {V.blurb}
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {STATES.map((name, i) => (
            <Button
              key={`state-${i}`}
              plain
              hotkey={String(i + 1)}
              onPress={() => update($, stateIx, () => i)}
            >
              {i === s ? (
                <Text color="claude" bold>
                  [{name}]
                </Text>
              ) : (
                <Text dimColor>{name}</Text>
              )}
            </Button>
          ))}
        </Box>
      </Box>
    );

    let body;
    if (V.key === "A") {
      body = (
        <Box flexDirection="column" rowGap={1}>
          {sys.map((x) => (
            <Box flexDirection="column">
              {head(x)}
              {kv(x.rows)}
            </Box>
          ))}
        </Box>
      );
    } else if (V.key === "B") {
      const c = o.collector;
      const events: { at: string; health: Health; text: string }[] = [
        {
          at: c.lastRefresh.at,
          health: c.lastRefresh.failed.length ? "warn" : "ok",
          text: `Refresh · ${c.lastRefresh.boards} boards, ${c.lastRefresh.failed.length ? `failed ${c.lastRefresh.failed.join(", ")}` : "0 failed"}`,
        },
        { at: o.daily.lastRead, health: o.daily.health, text: `Daily read · ${o.daily.rows} runs` },
        { at: o.bot.deployedAt, health: "ok", text: "Multiballs deployed" },
        { at: o.site.prodAt, health: "ok", text: `Site to prod · ${o.site.sha}` },
        ...o.site.previews.map((p) => ({
          at: p.at,
          health: "ok" as Health,
          text: `Preview · ${p.branch}`,
        })),
        { at: c.nextSlot, health: "ok", text: "Refresh slot" },
        { at: o.daily.closes, health: "ok", text: "Daily closes · Daily Report posts" },
      ];
      if (c.health === "bad")
        events.push({
          at: "2026-10-21T01:12:03Z",
          health: "bad",
          text: "Collector stopped (LoggedInElsewhere)",
        });
      if (c.health === "bad")
        events.push({ at: "2026-10-21T03:00:00Z", health: "bad", text: "Refresh slot missed" });
      for (const p of o.prs.filter((p) => p.health !== "ok"))
        events.push({
          at: "2026-10-21T02:51:00Z",
          health: p.health,
          text: `PR #${p.n} · ${p.checks}`,
        });
      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const past = events.filter((x) => x.at <= o.now).slice(-8);
      const next = events.filter((x) => x.at > o.now);
      const line = (x: (typeof events)[number], dim: boolean) => (
        <Box flexDirection="row">
          <Box width={10} flexShrink={0}>
            <Text dimColor>{ct(x.at)}</Text>
          </Box>
          <Text color={dim ? undefined : tone(x.health)} dimColor={dim}>
            {dim ? "○" : dot(x.health)}{" "}
          </Text>
          <Box flexShrink={1}>
            <Text dimColor={dim} wrap="wrap">
              {x.text}
            </Text>
          </Box>
        </Box>
      );
      body = (
        <Box flexDirection="column">
          {past.map((x) => line(x, false))}
          <Text color="claude">
            {`── now ${ct(o.now)} CT `.padEnd(Math.max(10, cols - 2), "─")}
          </Text>
          {next.map((x) => line(x, true))}
        </Box>
      );
    } else if (V.key === "C") {
      const w = wide ? Math.floor((cols - 1) / 2) : cols;
      body = (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {sys.map((x) => (
            <Box
              width={w}
              flexDirection="column"
              borderStyle="round"
              borderColor={x.health === "ok" ? "subtle" : tone(x.health)}
              paddingX={1}
            >
              <Text dimColor>{x.name.toUpperCase()}</Text>
              <Text bold color={tone(x.health)}>
                {x.health === "ok" ? "OK" : x.health === "warn" ? "CHECK" : "DOWN"}
              </Text>
              <Text wrap="wrap">{x.headline}</Text>
            </Box>
          ))}
        </Box>
      );
    } else if (V.key === "D") {
      const problems = sys.flatMap((x) =>
        x.name === "Pull requests"
          ? o.prs
              .filter((p) => p.health !== "ok")
              .map((p) => ({ health: p.health, text: `PR #${p.n}: ${p.checks}` }))
          : x.health === "ok"
            ? []
            : [{ health: x.health, text: `${x.name}: ${x.headline}` }],
      );
      body = (
        <Box flexDirection="column" rowGap={1}>
          {problems.length ? (
            <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
              <Text bold>Needs you</Text>
              {problems.map((p) => (
                <Text wrap="wrap">
                  <Text color={tone(p.health)}>{dot(p.health)} </Text>
                  {p.text}
                </Text>
              ))}
            </Box>
          ) : (
            <Text color="success" bold>
              All quiet ✓
            </Text>
          )}
          <Box flexDirection="column">
            {sys.map((x) => (
              <Text wrap="truncate-end">
                <Text color={tone(x.health)}>{dot(x.health)} </Text>
                <Text>{x.name.padEnd(14)}</Text>
                <Text dimColor>{x.headline}</Text>
              </Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text dimColor>Coming up</Text>
            {kv(
              [
                [ct(o.collector.nextSlot), "Refresh slot"],
                [ct(o.bot.nextReport), "Daily closes · Daily Report"],
              ],
              10,
            )}
          </Box>
        </Box>
      );
    } else {
      const x = sys[t] ?? sys[0]!;
      body = (
        <Box flexDirection="column" rowGap={1}>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {sys.map((y, i) => (
              <Button key={`tab-${i}`} plain onPress={() => update($, tab, () => i)}>
                <Text color={tone(y.health)}>{dot(y.health)}</Text>
                {i === t ? (
                  <Text bold underline>
                    {" "}
                    {y.name}
                  </Text>
                ) : (
                  <Text dimColor> {y.name}</Text>
                )}
              </Button>
            ))}
          </Box>
          <Box flexDirection="column">{kv(x.rows)}</Box>
          {x.name === "Collector" && (
            <Box flexDirection="column">
              <Text dimColor>Recent log (UTC)</Text>
              {o.collector.log.map((l) => (
                <Text wrap="truncate-end">{l}</Text>
              ))}
            </Box>
          )}
        </Box>
      );
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        {picker}
        {body}
        <Text dimColor>Snapshot {ct(o.now)} CT · times in Central</Text>
      </Box>
    );
  });
};
