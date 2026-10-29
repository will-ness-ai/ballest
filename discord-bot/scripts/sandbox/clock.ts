// The sandbox's clock: real time plus an offset the driver can move forward (`devserver clock`), so a
// week of the Weekly Cup plays out in minutes. A sleep wakes once the shifted time reaches its
// end, checked every half second, so a jump past a boundary acts at once. The offset is kept in
// .logs/sandbox-clock.json, so a restart with `--keep` resumes at the same moment.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { Clock, Duration, Effect } from "effect";
import { LOGS } from "./config.js";

const FILE = posix.join(LOGS, "sandbox-clock.json");
const TICK_MS = 500;

export const makeDevClock = (keep: boolean) => {
  let offset = 0;
  if (keep && existsSync(FILE))
    offset = (JSON.parse(readFileSync(FILE, "utf8")) as { offset: number }).offset;
  const now = () => Date.now() + offset;
  const save = () => {
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ offset }));
  };
  save();

  const clock: Clock.Clock = {
    [Clock.ClockTypeId]: Clock.ClockTypeId,
    unsafeCurrentTimeMillis: now,
    currentTimeMillis: Effect.sync(now),
    unsafeCurrentTimeNanos: () => BigInt(now()) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now()) * 1_000_000n),
    sleep: (duration) =>
      Effect.async<undefined>((resume) => {
        const end = now() + Duration.toMillis(duration);
        let timer: ReturnType<typeof setTimeout>;
        const check = () => {
          const left = end - now();
          if (left <= 0) resume(Effect.succeed(undefined));
          else timer = setTimeout(check, Math.min(left, TICK_MS));
        };
        check();
        return Effect.sync(() => clearTimeout(timer));
      }),
  };

  return {
    clock,
    now,
    /** Move the clock to `to` (ms); never back, so nothing already done is redone. */
    jump: (to: number) => {
      if (to > now()) offset = to - Date.now();
      save();
      return now();
    },
  };
};

export type DevClock = ReturnType<typeof makeDevClock>;
