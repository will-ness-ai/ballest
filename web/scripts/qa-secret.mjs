#!/usr/bin/env node
// Prints the secret qa signs a local build's sessions with (qa/session.mjs), so `pnpm serve`
// and `pnpm dev:up` serve under the same one and a local `qa check` is drawn signed in.
import { localSecret } from "./qa/session.mjs";

console.log(localSecret());
