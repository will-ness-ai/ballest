import { describe, expect, test } from "vitest";

import { ciState, landStep } from "../scripts/pr/land.mjs";

// `pnpm --silent pr wait` and `pr land` (scripts/pr.mjs): what a PR's head CI says, and what
// landing the PR does next, from what the REST API gives a cloud session.
const run = (name: string, status: string, conclusion: string | null = null) => ({
  name,
  status,
  conclusion,
});

describe("a head's CI", () => {
  test("is green once every check passed or was skipped", () => {
    expect(
      ciState([run("lint", "completed", "success"), run("authors", "completed", "skipped")]),
    ).toEqual({ state: "green", checks: 2 });
  });

  test("is running while a check or the preview hasn't finished, naming each once", () => {
    expect(
      ciState(
        [run("lint", "completed", "success"), run("build", "in_progress"), run("build", "queued")],
        { state: "pending" },
      ),
    ).toEqual({ state: "running", names: ["build", "vercel preview"] });
  });

  test("is red when a finished check didn't pass, even while others run", () => {
    expect(
      ciState([
        run("build", "completed", "failure"),
        run("build", "completed", "failure"),
        run("lint", "in_progress"),
      ]),
    ).toEqual({ state: "red", names: ["build"] });
    expect(ciState([], { state: "error" })).toEqual({ state: "red", names: ["vercel preview"] });
  });

  test("is waiting before any check has started", () => {
    expect(ciState([])).toEqual({ state: "none" });
  });
});

describe("landing a PR", () => {
  const open = { state: "open", merged: false, draft: false, mergeable_state: "clean" };
  const green = { state: "green", checks: 9 };
  const step = (pr: object, behind: number, ci: object) =>
    landStep({ ...open, ...pr }, behind, ci) as { do: string };

  test("merges a green, up-to-date PR, marking it ready first when it's a draft", () => {
    expect(step({}, 0, green).do).toBe("merge");
    expect(step({ draft: true }, 0, green).do).toBe("ready");
  });

  test("brings main in first, then waits for CI on the new head", () => {
    expect(step({ draft: true }, 3, green).do).toBe("update");
    expect(step({}, 0, { state: "running", names: ["build"] }).do).toBe("wait");
    expect(step({}, 0, { state: "none" }).do).toBe("wait");
  });

  test("stops on what only a fix can clear", () => {
    expect(step({}, 0, { state: "red", names: ["build"] })).toEqual({
      do: "stop",
      why: "red: build",
    });
    expect(step({ mergeable_state: "dirty" }, 2, green)).toEqual({
      do: "stop",
      why: "conflicts with main",
    });
    expect(step({ state: "closed" }, 0, green)).toEqual({ do: "stop", why: "closed unmerged" });
  });

  test("is a no-op once merged", () => {
    expect(step({ state: "closed", merged: true }, 0, green).do).toBe("done");
  });
});
