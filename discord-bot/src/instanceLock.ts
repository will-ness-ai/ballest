// One copy of the bot per channel on this machine. Two copies answer every click twice, post a
// second Footer and log the Steam account in twice, so a second start refuses to run.
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, Data, Effect, Layer } from "effect";

export class AlreadyRunning extends Data.TaggedError("AlreadyRunning")<{
  readonly message: string;
}> {}
class LockFileError extends Data.TaggedError("LockFileError")<{ readonly cause: unknown }> {}

const hasCode = (e: unknown, code: string) => e instanceof Error && "code" in e && e.code === code;

/** Whether a process with this id is running. EPERM means it exists but isn't ours to signal. */
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return hasCode(e, "EPERM");
  }
};

/**
 * The program running as this pid, or null if it can't be told. Windows hands a dead copy's pid
 * to other programs, so a live pid alone doesn't mean the bot is still running.
 */
const programOf = (pid: number): string | null => {
  try {
    if (process.platform === "win32") {
      const row = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
      });
      return /^"([^"]+)"/.exec(row.trim())?.[1] ?? null;
    }
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim() || null
    );
  } catch {
    return null;
  }
};

/** Whether the lock's holder is still a running copy of the bot (a Node process). Unsure counts as yes. */
const holdsLock = (pid: number) => {
  if (!isRunning(pid)) return false;
  const program = programOf(pid);
  return program === null || /node/i.test(program);
};

/** Create the lock file holding our pid; false if it already exists. */
const create = (path: string) =>
  Effect.try({
    try: () => {
      try {
        const fd = openSync(path, "wx");
        writeSync(fd, String(process.pid));
        closeSync(fd);
        return true;
      } catch (e) {
        if (hasCode(e, "EEXIST")) return false;
        throw e;
      }
    },
    catch: (cause) => new LockFileError({ cause }),
  });

const holderOf = (path: string) =>
  Effect.try({
    try: () => Number.parseInt(readFileSync(path, "utf8"), 10),
    catch: (cause) => new LockFileError({ cause }),
  }).pipe(Effect.orElseSucceed(() => Number.NaN));

const alreadyRunning = (pid: number, path: string) =>
  new AlreadyRunning({
    message: `Multiballs is already running for this channel (pid ${pid}); stop it first. Lock: ${path}`,
  });

export const acquire = Effect.fn("acquireInstanceLock")(function* (path: string) {
  if (yield* create(path)) return;
  const holder = yield* holderOf(path);
  if (Number.isInteger(holder) && holdsLock(holder)) return yield* alreadyRunning(holder, path);
  // Left behind by a copy that didn't shut down cleanly, its pid now gone or another program's.
  yield* Effect.try({
    try: () => unlinkSync(path),
    catch: (cause) => new LockFileError({ cause }),
  });
  if (!(yield* create(path))) return yield* alreadyRunning(yield* holderOf(path), path);
});

export const InstanceLockLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const channelId = yield* Config.string("DISCORD_CHANNEL_ID");
    const path = join(tmpdir(), `multiballs-${channelId}.lock`);
    yield* Effect.acquireRelease(acquire(path), () =>
      Effect.try({
        try: () => unlinkSync(path),
        catch: (cause) => new LockFileError({ cause }),
      }).pipe(Effect.ignore),
    );
  }),
);
