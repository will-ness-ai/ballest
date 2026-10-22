// The server's clock, so countdowns agree with the bot. Each poll says what time the server
// makes it; the difference is only taken up when it moves by more than a second, so network
// jitter doesn't nudge every countdown (or the Discord status's end time) on each poll.

const DRIFT_MS = 1_000;
const TICK_MS = 250;

let offset: number | null = null;
let current = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

const tick = () => {
  current = Date.now() + (offset ?? 0);
  for (const l of listeners) l();
};

export const serverClock = {
  /** Server clock minus ours. */
  offset: () => offset ?? 0,
  /** Take a poll's `now`. */
  heard: (serverNow: number) => {
    const next = serverNow - Date.now();
    if (offset === null || Math.abs(next - offset) > DRIFT_MS) offset = next;
  },
  /** The server's time at the last tick: stable between ticks, as useSyncExternalStore needs. */
  now: () => current,
  /** Ticks four times a second while anything is listening. */
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    timer ??= setInterval(tick, TICK_MS);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        clearInterval(timer);
        timer = undefined;
      }
    };
  },
};

/** Seconds as m:ss. */
export const clockText = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
