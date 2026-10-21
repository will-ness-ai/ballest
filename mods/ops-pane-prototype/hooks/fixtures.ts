// PROTOTYPE fixtures for the ops pane grill. "good" is the real state at 2026-10-21 03:10 UTC
// (Fly machines API, Vercel deployments, ballestrecords.com's refreshedAt, GitHub checks); the
// Daily numbers and log lines are made up. The other states break one thing each.

export type Health = "ok" | "warn" | "bad";

export type Ops = {
  now: string;
  collector: {
    health: Health;
    machine: string;
    note: string;
    lastRefresh: { at: string; boards: number; failed: string[] };
    mapsReadBy: string;
    nextSlot: string;
    job: string;
    log: string[];
  };
  daily: { health: Health; board: string; lastRead: string; rows: number; closes: string };
  bot: { health: Health; machines: number; deployedAt: string; nextReport: string };
  site: {
    health: Health;
    prodAt: string;
    sha: string;
    message: string;
    previews: { branch: string; state: string; at: string }[];
  };
  prs: { n: number; title: string; health: Health; checks: string; draft: boolean }[];
};

export const STATES = ["good", "refresh failed", "collector down", "PR red"] as const;
export type StateName = (typeof STATES)[number];

const good: Ops = {
  now: "2026-10-21T03:10:00Z",
  collector: {
    health: "ok",
    machine: "started · ord",
    note: "idle until the next slot",
    lastRefresh: { at: "2026-10-21T03:04:28Z", boards: 41, failed: [] },
    mapsReadBy: "2026-10-21T03:00:00Z",
    nextSlot: "2026-10-21T06:00:00Z",
    job: "Daily watcher",
    log: [
      "03:00:01 refresh: start (slot 03:00)",
      "03:04:28 refresh: 41 boards, 0 failed, 1,204 changed",
      "03:04:31 revalidate: 200",
      "03:09:02 daily_watch: board 18422331, 212 rows",
    ],
  },
  daily: {
    health: "ok",
    board: "Daily 2026-10-20",
    lastRead: "2026-10-21T03:09:02Z",
    rows: 212,
    closes: "2026-10-21T16:00:00Z",
  },
  bot: {
    health: "ok",
    machines: 1,
    deployedAt: "2026-10-20T00:35:16Z",
    nextReport: "2026-10-21T16:00:00Z",
  },
  site: {
    health: "ok",
    prodAt: "2026-10-20T00:33:22Z",
    sha: "fb8d443",
    message: "Collector: a Daily watcher reads the Daily every minute (#289)",
    previews: [
      { branch: "claude/prototype-homepage", state: "ready", at: "2026-10-20T19:25:55Z" },
      { branch: "claude/ball-icon-picker-ozqkqh", state: "ready", at: "2026-10-20T11:50:20Z" },
    ],
  },
  prs: [
    { n: 297, title: "Retro fixes from #280", health: "ok", checks: "8 passed", draft: false },
    { n: 296, title: "Collector: one Steam login", health: "ok", checks: "6 passed", draft: false },
    {
      n: 293,
      title: "Daily Post: remove the backfill",
      health: "ok",
      checks: "7 passed",
      draft: false,
    },
    { n: 286, title: "Multiballs: Traffic Report", health: "ok", checks: "7 passed", draft: true },
    { n: 178, title: "Plugin docs: sandbox.py", health: "ok", checks: "8 passed", draft: false },
  ],
};

export function fixture(state: StateName): Ops {
  if (state === "refresh failed")
    return {
      ...good,
      collector: {
        ...good.collector,
        health: "warn",
        lastRefresh: { ...good.collector.lastRefresh, failed: ["Map_Track13", "Overall_S2"] },
        log: [
          "03:00:01 refresh: start (slot 03:00)",
          "03:02:40 read Map_Track13: timeout after 3 tries",
          "03:03:10 read Overall_S2: empty, kept old Entries",
          "03:04:28 refresh: 41 boards, 2 failed, 1,180 changed",
        ],
      },
    };
  if (state === "collector down")
    return {
      ...good,
      collector: {
        ...good.collector,
        health: "bad",
        machine: "stopped · ord",
        note: "stopped 01:12 UTC, missed the 03:00 slot",
        lastRefresh: { at: "2026-10-21T00:04:11Z", boards: 41, failed: [] },
        job: "none",
        log: [
          "00:04:11 refresh: 41 boards, 0 failed",
          "01:11:58 daily_watch: board 18422331, 205 rows",
          "01:12:03 steam: logged off (LoggedInElsewhere)",
          "01:12:03 runner: exit 1",
        ],
      },
      daily: { ...good.daily, health: "bad", lastRead: "2026-10-21T01:11:58Z", rows: 205 },
    };
  if (state === "PR red")
    return {
      ...good,
      prs: good.prs.map((pr) =>
        pr.n === 296
          ? { ...pr, health: "bad", checks: "collector-tests failed" }
          : pr.n === 297
            ? { ...pr, health: "warn", checks: "qa: 2 pages differ" }
            : pr,
      ),
    };
  return good;
}
