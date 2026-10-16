// A Campaign Map says so wherever it shows: the picture strip on its card (the shelves and
// All maps) and the Part of box on its page, which leads to the Map inside its Campaign.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { MapCardLink } from "../components/workshop/Card";
import { PartOf } from "../components/workshop/Campaign";
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
