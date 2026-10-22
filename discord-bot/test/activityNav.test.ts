// Which Match the Activity's page shows, as the board changes under it and the viewer presses
// things (src/activity/web/nav.ts). The page draws whatever this says, so these are its rules for
// the lock, watching, a Result staying up, and the Go! bar.
import { describe, expect, it } from "vitest";
import type { MatchView } from "../src/activity/api.js";
import { type Board, type Lookup, NO_NAV, type Nav, navigate } from "../src/activity/web/nav.js";

const ME = "d-me";
const OTHER = "d-other";

const match = (id: string, state: MatchView["state"], racers: ReadonlyArray<string> = [ME]) =>
  ({
    matchId: id,
    state,
    players: racers.map((discordId) => ({ discordId, steamId: `s-${discordId}` })),
  }) as unknown as MatchView;

const board = (matchId: string | null, matches: ReadonlyArray<MatchView>): Board => ({
  me: { discordId: ME, link: null, pings: null, matchId, pingRole: "@ping" },
  now: 1_000,
  matches,
});

const NOTHING: Lookup = null;
const at = 5_000;
const step = (nav: Nav, b: Board, lookup: Lookup = NOTHING) =>
  navigate(nav, { kind: "board", board: b, lookup, at });

describe("the lock", () => {
  it("shows your own Match the moment the board says you're racing in it", () => {
    const nav = step({ ...NO_NAV, composing: true, watching: "w" }, board("m1", [match("m1", "invite")]));
    expect(nav.mine).toBe("m1");
    expect(nav.watching).toBeNull();
    expect(nav.composing).toBe(false);
    expect(nav.shown?.matchId).toBe("m1");
  });

  it("leaves a Challenge that only names you in the Gallery", () => {
    const nav = step(NO_NAV, board("m1", [match("m1", "invite", [OTHER])]));
    expect(nav.mine).toBeNull();
    expect(nav.shown).toBeNull();
  });

  it("keeps your Result on screen after the Match ends, until Back", () => {
    const live = step(NO_NAV, board("m1", [match("m1", "live")]));
    const ended = step(live, board(null, []), { id: "m1", match: match("m1", "finished"), closed: null });
    expect(ended.mine).toBe("m1");
    expect(ended.shown?.state).toBe("finished");
    const back = navigate(ended, { kind: "back" });
    expect(back.mine).toBeNull();
    expect(back.shown).toBeNull();
  });

  it("waits for the Match to be looked up before deciding it has gone", () => {
    const live = step(NO_NAV, board("m1", [match("m1", "live")]));
    const unsure = step(live, board(null, []));
    expect(unsure).toEqual(live);
  });

  it("watches a live Match you left from the channel", () => {
    const live = step(NO_NAV, board("m1", [match("m1", "live")]));
    const left = step(live, board(null, [match("m1", "live")]));
    expect(left.mine).toBeNull();
    expect(left.watching).toBe("m1");
    expect(left.shown?.matchId).toBe("m1");
  });

  it("drops an Invite you left from the channel", () => {
    const invite = step(NO_NAV, board("m1", [match("m1", "invite")]));
    const left = step(invite, board(null, [match("m1", "invite")]));
    expect(left.mine).toBeNull();
    expect(left.watching).toBeNull();
    expect(left.shown).toBeNull();
  });

  it("says no Map fitted when your Invite was cancelled for it", () => {
    const invite = step(NO_NAV, board("m1", [match("m1", "invite")]));
    const gone = step(invite, board(null, []), { id: "m1", match: null, closed: "noEligibleMap" });
    expect(gone.noMap?.matchId).toBe("m1");
    expect(gone.mine).toBeNull();
    expect(gone.shown).toBeNull();
  });
});

describe("watching", () => {
  it("shows the Match you opened, and goes back to the Gallery once it's gone", () => {
    const watching = navigate(NO_NAV, { kind: "watch", match: match("m2", "live", [OTHER]) });
    expect(watching.shown?.matchId).toBe("m2");
    const gone = step(watching, board(null, []), { id: "m2", match: null, closed: null });
    expect(gone.watching).toBeNull();
    expect(gone.shown).toBeNull();
  });

  it("follows the watched Match to its Result", () => {
    const watching = navigate(NO_NAV, { kind: "watch", match: match("m2", "live", [OTHER]) });
    const done = step(watching, board(null, []), {
      id: "m2",
      match: match("m2", "finished", [OTHER]),
      closed: null,
    });
    expect(done.watching).toBe("m2");
    expect(done.shown?.state).toBe("finished");
  });
});

describe("Go!", () => {
  it("goes up when your Invite turns live on the board", () => {
    const invite = step(NO_NAV, board("m1", [match("m1", "invite")]));
    const live = step(invite, board("m1", [match("m1", "live")]));
    expect(live.go).toEqual({ matchId: "m1", at });
  });

  it("goes up when your own start or join comes back live", () => {
    const nav = navigate(NO_NAV, { kind: "entered", id: "m1", match: match("m1", "live"), at });
    expect(nav.mine).toBe("m1");
    expect(nav.go).toEqual({ matchId: "m1", at });
  });

  it("doesn't go up for a Match you were already racing when the page opened", () => {
    const nav = step(NO_NAV, board("m1", [match("m1", "live")]));
    expect(nav.go).toBeNull();
  });

  it("comes down when the Map is opened in the Workshop", () => {
    const nav = navigate(NO_NAV, { kind: "entered", id: "m1", match: match("m1", "live"), at });
    expect(navigate(nav, { kind: "workshop" }).go).toBeNull();
  });
});

describe("entering a Match", () => {
  it("locks onto an Invite you opened, before the board has it", () => {
    const nav = navigate(
      { ...NO_NAV, composing: true },
      { kind: "entered", id: "m3", match: null, at },
    );
    expect(nav.mine).toBe("m3");
    expect(nav.composing).toBe(false);
    expect(nav.go).toBeNull();
  });

  it("says no Map fitted when a start finds none", () => {
    const m = match("m1", "invite");
    const nav = navigate(step(NO_NAV, board("m1", [m])), { kind: "noMap", match: m });
    expect(nav.noMap).toBe(m);
    expect(nav.mine).toBeNull();
  });
});
