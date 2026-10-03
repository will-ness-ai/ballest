import { expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquire } from "../src/instanceLock.js"

const lockIn = () =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "multiballs-lock-"))),
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true }))
  ).pipe(Effect.map((dir) => join(dir, "multiballs.lock")))

it.scoped("refuses to start while another copy of the bot holds the lock", () =>
  Effect.gen(function* () {
    const path = yield* lockIn()
    writeFileSync(path, String(process.pid)) // this test runs on Node, like the bot
    const exit = yield* Effect.exit(acquire(path))
    expect(Exit.isFailure(exit)).toBe(true)
  })
)

it.scoped("takes over a lock whose pid now belongs to some other program", () =>
  Effect.gen(function* () {
    const path = yield* lockIn()
    const other = yield* Effect.acquireRelease(
      Effect.sync(() => spawn("sleep", ["30"])),
      (p) => Effect.sync(() => p.kill())
    )
    writeFileSync(path, String(other.pid))
    yield* acquire(path)
    expect(readFileSync(path, "utf8")).toBe(String(process.pid))
  })
)

it.scoped("takes over a lock whose pid is gone", () =>
  Effect.gen(function* () {
    const path = yield* lockIn()
    writeFileSync(path, "999999999")
    yield* acquire(path)
    expect(readFileSync(path, "utf8")).toBe(String(process.pid))
  })
)
