import { describe, expect, it } from "vitest";

import { repoSlug } from "../scripts/github.mjs";

// The repo `pnpm --silent pr` and the pre-push hook ask GitHub about, read from origin.
describe("repoSlug", () => {
  it("reads owner/name from GitHub's, a proxy's and an SSH remote, in lower case", () => {
    for (const url of [
      "https://github.com/Will-Ness-AI/Ballest.git",
      "http://local_proxy@127.0.0.1:1/git/will-ness-ai/ballest",
      "git@github.com:will-ness-ai/ballest.git",
      "github.com/will-ness-ai/ballest/",
    ])
      expect(repoSlug(url), url).toBe("will-ness-ai/ballest");
  });
});
