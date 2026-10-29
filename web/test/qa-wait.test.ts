import { describe, expect, it } from "vitest";

import { settled } from "../scripts/qa/targets.mjs";

// qa check --wait: a thread that pushed a commit waits for its preview to build at HEAD in
// one call, rather than polling `pnpm --silent qa` itself (retro of #365: about 20 polls).
const reads = (...states: Array<{ state: string; behind?: boolean }>) => {
  let i = 0;
  return () => ({ name: "preview", url: "https://p", ...states[Math.min(i++, states.length - 1)] });
};
const noSleep = () => Promise.resolve();

describe("settled", () => {
  it("waits until the preview is built at HEAD", async () => {
    const read = reads(
      { state: "not deployed" },
      { state: "success", behind: true },
      { state: "pending" },
      { state: "success", behind: false },
    );
    const t = await settled(read, { every: 1, limit: 100, sleep: noSleep });
    expect(t).toMatchObject({ state: "success", behind: false });
  });

  it("stops at a build at HEAD that failed, not an older one", async () => {
    const read = reads(
      { state: "failure", behind: true },
      { state: "pending" },
      { state: "failure" },
      { state: "success" },
    );
    const t = await settled(read, { every: 1, limit: 100, sleep: noSleep });
    expect(t.state).toBe("failure");
    expect(t.behind).toBeFalsy();
  });

  it("gives up after its limit with the last state it saw", async () => {
    let slept = 0;
    const sleep = (ms: number) => {
      slept += ms;
      return Promise.resolve();
    };
    const t = await settled(reads({ state: "pending" }), { every: 10, limit: 35, sleep });
    expect(t.state).toBe("pending");
    expect(slept).toBe(40);
  });
});
