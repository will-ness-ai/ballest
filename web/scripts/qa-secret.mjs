#!/usr/bin/env node
// `scripts/qa-secret.mjs <production|development>`: prints qa-only when no SESSION_SECRET is
// configured for a server in that mode (the environment, or a .env file Next would load),
// and nothing when one is, so `pnpm serve` and `pnpm dev:up` export qa's fallback only where
// the server would otherwise have none, and a local `qa check` is drawn signed in.
import { QA_SECRET, configuredSecret } from "./qa/session.mjs";

const mode = process.argv[2];
if (mode !== "production" && mode !== "development") {
  console.log("usage: scripts/qa-secret.mjs <production|development>");
  process.exit(2);
}
if (!configuredSecret(process.env, undefined, mode)) console.log(QA_SECRET);
