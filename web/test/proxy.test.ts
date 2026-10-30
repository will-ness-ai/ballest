// The checks web/proxy.ts makes before a response starts, through the proxy itself: the
// redirects it answers and the paths it lets through to their pages.
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

import { proxy } from "../proxy";

const ID = "76561198259485267";
const at = (path: string) => proxy(new NextRequest(new URL(path, "https://ballestrecords.com")));
const target = (path: string) => {
  const res = at(path);
  return [res.status, res.headers.get("location")];
};

describe("Leth Trial #1, a Trial now, not a Campaign", () => {
  test("its old Campaign and its Map page go to its Trial page for good", () => {
    const page = "https://ballestrecords.com/board/Map_LethTrial_01";
    expect(target("/campaign/leth-trials")).toEqual([308, page]);
    expect(target("/campaign/leth-trials/")).toEqual([308, page]);
    expect(target("/campaign/leth-trials/leth-trial-1")).toEqual([308, page]);
    expect(target("/campaign/leth-trials/podiums")).toEqual([308, page]);
  });

  test("a row marked on its old Map page stays marked", () => {
    expect(target(`/campaign/leth-trials/leth-trial-1/${ID}`)).toEqual([
      308,
      `https://ballestrecords.com/board/Map_LethTrial_01/${ID}`,
    ]);
  });

  test("so does a row marked on its old Campaign board", () => {
    const row = `https://ballestrecords.com/board/Map_LethTrial_01/${ID}`;
    expect(target(`/campaign/leth-trials/${ID}`)).toEqual([308, row]);
    expect(target(`/campaign/leth-trials/${ID}/`)).toEqual([308, row]);
  });

  test("its Trial page is a board, with or without a row", () => {
    expect(at("/board/Map_LethTrial_01").status).toBe(200);
    expect(at(`/board/Map_LethTrial_01/${ID}`).status).toBe(200);
  });

  test("a Campaign that never was is still a 404", () => {
    expect(at("/campaign/leth-trialz").status).toBe(404);
  });
});

describe("a player's Official tab, which was the Circuit tab", () => {
  test("an old Circuit tab link goes to the Official tab for good", () => {
    expect(target(`/player/${ID}/circuit`)).toEqual([
      308,
      `https://ballestrecords.com/player/${ID}/official`,
    ]);
  });

  test("the Official tab is a player's page", () => {
    expect(at(`/player/${ID}/official`).status).toBe(200);
  });
});
