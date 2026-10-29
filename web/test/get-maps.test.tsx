// Get the Maps on a Campaign's page (spec #359, ticket #360): the floating button and the
// checklist it opens, of the Campaign's Workshop Maps in its order with a Subscribe link to
// each Map's Workshop page, a Steam collection's Subscribe to all where the Campaign has one,
// then the steps in the game. Event boards have no Workshop page, so they are left out.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { GetMaps } from "../components/campaign/GetMaps";
import { getMapRows, type Campaign } from "../lib/campaigns";
import type { WorkshopMap } from "../lib/rows";

const RUN: Campaign = {
  slug: "marble-run",
  title: "Marble Run",
  creator: "Tenpin",
  creatorId: "76561199000000010",
  maps: ["9000000001", "leth-trial-1", "9000000002"],
};

const map = (pfid: string, title: string, preview: string | null): WorkshopMap => ({
  pfid,
  name: "Workshop_" + pfid,
  title,
  creator: "Tenpin",
  cid: "76561199000000010",
  preview,
  created: 1_760_000_000,
  medals: [40, 30, 25, 20.5],
  entryCount: 3,
  sessions: 9,
  subs: 4,
  top3: [],
  gap13: null,
  crowd: 1,
  authorBeaten: 0,
  fileVersion: null,
  weekPlays: 0,
  votesUp: 0,
  votesDown: 0,
  voteScore: 0,
});

/* the page's Maps as getCampaign gives them: listed ones in the Campaign's order, an Event
   board drawn as a Map */
const MAPS = [
  map("9000000001", "Marble Run Hills", "https://images.example/hills.jpg"),
  map("leth-trial-1", "Leth Trial #1", "/leth/screenshot.jpg"),
  map("9000000002", "Marble Run 03", null),
];

/* the markup's text, each element's edge a | */
const text = (html: string) =>
  html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|");
const draw = (c: Campaign) => renderToStaticMarkup(<GetMaps c={c} rows={getMapRows(c, MAPS)} />);
const ws = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

describe("the rows", () => {
  test("are the Workshop Maps in the Campaign's order, numbered and named as the rail does", () => {
    expect(getMapRows(RUN, MAPS)).toEqual([
      { pfid: "9000000001", no: "01", name: "Hills", pic: "https://images.example/hills.jpg" },
      { pfid: "9000000002", no: "03", name: null, pic: "" },
    ]);
  });
});

describe("the checklist", () => {
  test("opens from a button counting the Maps", () => {
    expect(text(draw(RUN))).toContain("|Get the 2 Maps|");
  });

  test("lists each Map with a Subscribe link to its Workshop page, then the steps in the game", () => {
    const html = draw(RUN);
    expect(html).toContain(`href="${ws("9000000001")}" target="_blank"`);
    expect(html).toContain(`href="${ws("9000000002")}" target="_blank"`);
    expect(html).not.toContain("leth-trial-1");
    const t = text(html);
    expect(t).toContain("|Play Marble Run in Ballest|");
    expect(t).toContain("|0 of 2 opened|");
    expect(t).toContain("|01|Hills|Subscribe ↗|03|Map 03|Subscribe ↗|");
    expect(t).toContain("|1|Open each Map in the Steam Workshop|2|Press Subscribe|");
    expect(t).toContain("|Then in Ballest|3|Go to the Hub|4|Press the Downloads button|");
  });

  test("offers a Steam collection's Subscribe to all only where the Campaign has one", () => {
    expect(draw(RUN)).not.toContain("at once");
    const html = draw({ ...RUN, collection: "3805419594" });
    expect(html).toContain(`href="${ws("3805419594")}" target="_blank"`);
    expect(text(html)).toContain("|Subscribe to all 2 at once ↗|");
  });

  test("is nothing for a Campaign with no Workshop Map", () => {
    const html = renderToStaticMarkup(
      <GetMaps c={{ ...RUN, slug: "leth-trials", maps: ["leth-trial-1"] }} rows={[]} />,
    );
    expect(html).toBe("");
  });
});
