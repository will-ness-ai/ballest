// A Campaign Map says so wherever it shows: the picture strip on its card (the shelves and
// All maps) and the Part of box on its page, which leads to the Map inside its Campaign.
// And every count of a Campaign's Maps it shows is its curated total, as its Maps' numbers
// are, even while the Workshop lists fewer of them.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { CampaignBanner } from "../components/campaign/CampaignBanner";
import { CampaignRailItems } from "../components/campaign/CampaignRail";
import { CampaignChip } from "../components/campaign/CampaignSwitch";
import { CampaignCards } from "../components/player/CampaignCards";
import { MapCardLink } from "../components/workshop/Card";
import { PartOf } from "../components/workshop/Campaign";
import type { ListedCampaign } from "../db/data";
import { CAMPAIGNS } from "../lib/campaigns";
import type { WorkshopMap } from "../lib/rows";
import type { MapCard } from "../lib/workshop";

const card = (pfid: string, title: string): MapCard => ({
  pfid,
  title,
  creator: "habibal223366977",
  cid: "76561199154600151",
  preview: null,
  created: 1_760_000_000,
  author: 114.645,
  entryCount: 39,
  sessions: 45,
  top3: [["76561198000000001", "Jrod", 6_771_800]],
  gap13: null,
  crowd: 0,
  authorBeaten: 0,
});

/* the markup's text, each element's edge a | */
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "|");

test("a Campaign Map's card carries the strip: the Campaign's name, then n / N", () => {
  const html = renderToStaticMarkup(
    <MapCardLink m={card("3805391903", "Solar Trials Earth")} stat="45 plays" />,
  );
  expect(html).toContain('class="cb-strip"');
  expect(text(html)).toMatch(/\|Solar Trials\|+3 \/ 9\|/);
});

test("any other Map's card has no strip", () => {
  const html = renderToStaticMarkup(
    <MapCardLink m={card("9000000001", "Sway n So")} stat="1,768 plays" />,
  );
  expect(html).not.toContain("cb-strip");
});

test("a Campaign Map's page names its Campaign and place, and links to it in the frame", () => {
  const html = renderToStaticMarkup(<PartOf pfid="3805391903" />);
  expect(html).toContain('href="/campaign/solar-trials/3805391903"');
  expect(text(html)).toContain("|Solar Trials|");
  expect(text(html)).toContain("Map 3 of 9");
});

test("any other Map's page has no Part of box", () => {
  expect(renderToStaticMarkup(<PartOf pfid="9000000001" />)).toBe("");
});

/* Solar Trials (9 Maps) with one Map gone from the Workshop: 8 pictures */
const solar = CAMPAIGNS[0];
const listed: ListedCampaign = {
  c: solar,
  players: 41,
  previews: Array<string | null>(8).fill(null),
  leader: null,
};

test("a Campaign's banner and switch count all its Maps, listed or not", () => {
  expect(text(renderToStaticMarkup(<CampaignBanner k={listed} />))).toContain(
    "Campaign · 9 maps · 41 players",
  );
  expect(
    text(renderToStaticMarkup(<CampaignChip list={[listed]} on={solar} board="b" />)),
  ).toContain("9 Maps · 41 players");
});

test("a player's Campaign card counts their Maps out of all the Campaign's", () => {
  const html = renderToStaticMarkup(
    <CampaignCards
      campaigns={[
        { c: solar, previews: listed.previews, rank: 2, score: 1200, finished: 6, players: 41 },
      ]}
      id="76561198000000001"
    />,
  );
  expect(text(html)).toContain("1,200 pts · 6/9 maps");
  expect(html).toContain("width:67%");
});

const railMap = (pfid: string, title: string): WorkshopMap => ({
  ...card(pfid, title),
  name: "Workshop_" + pfid,
  medals: [],
  subs: 0,
});

test("the rail names a Map by its number, then its name when it has one besides", () => {
  const [solarC, , , miniblack] = CAMPAIGNS;
  const rail = (c: (typeof CAMPAIGNS)[number], m: WorkshopMap) =>
    text(renderToStaticMarkup(<CampaignRailItems c={c} maps={[m]} current="" players={41} />));
  // "Miniblack 01" is the 1st Map: its number alone, not "01 01"
  const mini = rail(miniblack, railMap("3811078255", "Miniblack 01"));
  // the number, the record, then straight to the runs
  expect(mini).toMatch(/\|01\|\|[^|]+\| \|39 runs\|/);
  expect(mini).not.toContain("Miniblack");
  const solarRail = rail(solarC, railMap("3805391903", "Solar Trials Earth"));
  expect(solarRail).toContain("|03|");
  expect(solarRail).toContain("|Earth|");
});
