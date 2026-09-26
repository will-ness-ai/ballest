// One copy of the bot per channel on this machine. Two copies answer every click twice, post a
// second Footer and log the Steam account in twice, so a second start refuses to run.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Config, Data, Effect, Layer } from "effect"

export class AlreadyRunning extends Data.TaggedError("AlreadyRunning")<{ readonly message: string }> {}
class LockFileError extends Data.TaggedError("LockFileError")<{ readonly cause: unknown }> {}

const hasCode = (e: unknown, code: string) => e instanceof Error && "code" in e && e.code === code

/** Whether a process with this id is running. EPERM means it exists but isn't ours to signal. */
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return hasCode(e, "EPERM")
  }
}

/** Create the lock file holding our pid; false if it already exists. */
const create = (path: string) =>
  Effect.try({
    try: () => {
      try {
        const fd = openSync(path, "wx")
        writeSync(fd, String(process.pid))
        closeSync(fd)
        return true
      } catch (e) {
        if (hasCode(e, "EEXIST")) return false
        throw e
      }
    },
    catch: (cause) => new LockFileError({ cause })
  })

const holderOf = (path: string) =>
  Effect.try({ try: () => Number.parseInt(readFileSync(path, "utf8"), 10), catch: (cause) => new LockFileError({ cause }) }).pipe(
    Effect.orElseSucceed(() => Number.NaN)
  )

const alreadyRunning = (pid: number, path: string) =>
  new AlreadyRunning({ message: `Multiballs is already running for this channel (pid ${pid}); stop it first. Lock: ${path}` })

const acquire = Effect.fn("acquireInstanceLock")(function* (path: string) {
  if (yield* create(path)) return
  const holder = yield* holderOf(path)
  if (Number.isInteger(holder) && isRunning(holder)) return yield* alreadyRunning(holder, path)
  // Left behind by a copy that didn't shut down cleanly.
  yield* Effect.try({ try: () => unlinkSync(path), catch: (cause) => new LockFileError({ cause }) })
  if (!(yield* create(path))) return yield* alreadyRunning(yield* holderOf(path), path)
})

export const InstanceLockLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const channelId = yield* Config.string("DISCORD_CHANNEL_ID")
    const path = join(tmpdir(), `multiballs-${channelId}.lock`)
    yield* Effect.acquireRelease(acquire(path), () =>
      Effect.try({ try: () => unlinkSync(path), catch: (cause) => new LockFileError({ cause }) }).pipe(Effect.ignore)
    )
  })
)
