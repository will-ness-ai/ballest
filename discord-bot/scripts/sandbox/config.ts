// The sandbox's settings, shared by the bot copy (scripts/sandbox.ts) and the CLI (scripts/axi.ts):
// its channel, made by `pnpm axi sandbox create`, and the driver's port.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
// Forward slashes on Windows too: the paths are printed for agents, and Node takes them as they are.
import { posix } from "node:path"
const { join } = posix

export const LOGS = ".logs"
export const SANDBOX_FILE = join(LOGS, "sandbox.json")
export const DRIVER_PORT = Number(process.env["SANDBOX_DRIVER_PORT"] ?? 8741)
/** The Activity's port in the sandbox, clear of `pnpm dev`'s 8080. */
export const SANDBOX_HTTP_PORT = 8742

export interface SandboxFile {
  readonly guildId: string
  readonly channelId: string
  readonly channelName: string
}

export const readSandbox = (): SandboxFile | null =>
  existsSync(SANDBOX_FILE) ? (JSON.parse(readFileSync(SANDBOX_FILE, "utf8")) as SandboxFile) : null

export const writeSandbox = (s: SandboxFile | null) => {
  mkdirSync(LOGS, { recursive: true })
  if (s === null) writeFileSync(SANDBOX_FILE, "null")
  else writeFileSync(SANDBOX_FILE, JSON.stringify(s, null, 2))
}
