// A Campaign's board at 0, 1 and 2 rows: a Campaign of one Map, Map B of the tiny dataset
// (p10 then p2), read through the site's queries, with the pieces its page draws above the
// list. Under three rows there are no plates, so every row stays in the list; the Overall
// card shows what it has, and with nobody it shows a dash rather than a broken bar.
import { and, eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { BoardBody } from "../components/board/BoardBody";
import { OverallCard, PodiumPlates, ScorePlates } from "../components/board/BoardTop";
import { entries } from "../db/schema";
import { seed } from "../db/seed/harness";
import { boardPage, mapPodiums } from "../db/site";
import type { Campaign } from "../lib/campaigns";
import type { IndexBoard } from "../lib/player";
import { podiumRows, tally } from "../lib/podiums";
import { freshDb } from "./pg";

const SMALL = vi.hoisted((): Campaign => ({
  slug: "small-run",
  title: "Small Run",
  creator: "Tenpin",
  creatorId: "76561199000000010",
  maps: ["9000000002"],
}));
vi.mock("../lib/campaigns", async (original) => {
  const m = await original<typeof import("../lib/campaigns")>();
  (m.CAMPAIGNS as Array<Campaign>).push(SMALL);
  return m;
});

const p = (n: number) => `765611990000000${String(n).padStart(2, "0")}`;
const BOARD = "OverallCampaign_small-run";
const MAP_B = "Workshop_9000000002";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
});
afterAll(() => t.drop());

/* the markup's text, each element's edge a | */
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "|");

/* the board as the Campaign's page draws it, on both orders */
async function drawn() {
  const page = await boardPage(t.db, BOARD, { count: 100 });
  const tal = tally(SMALL.title, [MAP_B], await mapPodiums(t.db, [MAP_B]), () => "01");
  const b: IndexBoard = {
    name: BOARD,
    group: SMALL.title,
    tier: null,
    display: "Overall",
    entryCount: page.total,
  };
  const card = (podiums: boolean) =>
    renderToStaticMarkup(
      <OverallCard b={b} rows={page.rows} tally={tal} tracks={1} podiums={podiums} />,
    );
  const score = renderToStaticMarkup(
    <BoardBody
      order="score"
      name={BOARD}
      points
      where={SMALL.title}
      count={page.total}
      leaders={<ScorePlates name={BOARD} rows={page.rows} focus={null} />}
      initial={page.rows}
      lead={page.rows[0]?.score ?? null}
      pods={null}
      focus={null}
    />,
  );
  const podiums = renderToStaticMarkup(
    <BoardBody
      order="podiums"
      name={BOARD}
      points
      where={SMALL.title}
      count={page.total}
      leaders={<PodiumPlates tally={tal} />}
      players={podiumRows(tal, {})}
      tracks={tal.tracks}
      group={SMALL.title}
    />,
  );
  return { page, tal, card: card(false), podCard: card(true), score, podiums };
}

/* close a player's Entry on Map B, as a Refresh that no longer finds it would */
const close = (n: number) =>
  t.db
    .update(entries)
    .set({ closedRefresh: 3 })
    .where(and(eq(entries.board, MAP_B), eq(entries.steamId, p(n))));

const plates = (html: string) => /<div class="leaders" id="leaders"( hidden)?/.exec(html)?.[1];

describe("a Campaign's board with few rows", () => {
  test("2 rows: both in the list, no plates, two bars on the card", async () => {
    const d = await drawn();
    expect(d.page.rows.map((r) => [r.rank, r.steamId, r.score])).toEqual([
      [1, p(10), 40000],
      [2, p(2), 20000],
    ]);
    expect(plates(d.score)).toBe(" hidden");
    expect(plates(d.podiums)).toBe(" hidden");
    expect(d.score).toContain(`data-id="${p(10)}"`);
    expect(d.score).toContain(`data-id="${p(2)}"`);
    expect(d.card).toContain("width:100.0%");
    expect(d.card).toContain("width:50.0%");
    expect(text(d.card)).toContain("Players||2");
    expect(text(d.card)).toContain("across its one map");
    expect(d.tal.players.map((x) => [x.steamId, x.gold, x.silver])).toEqual([
      [p(10), 1, 0],
      [p(2), 0, 1],
    ]);
    expect(text(d.podiums)).toContain("2 players on a podium · 1 map");
    expect(d.podCard).not.toContain("NaN");
  });

  test("1 row: the leader alone, in the list, a full bar", async () => {
    await close(2);
    const d = await drawn();
    expect(d.page.total).toBe(1);
    expect(plates(d.score)).toBe(" hidden");
    expect(d.score).toContain(`data-id="${p(10)}"`);
    expect(d.card).toContain("width:100.0%");
    expect(text(d.card)).toMatch(/Leader\|\|[^|]*\|?Tenpin/);
    expect(text(d.card)).toContain("Most podiums");
    expect(text(d.podiums)).toContain("1 player on a podium · 1 map");
    expect(d.podCard).toContain("width:100.0%");
  });

  test("0 rows: no plates, no bars, a dash for the leader and the empty list", async () => {
    await close(10);
    const d = await drawn();
    expect(d.page).toEqual({ total: 0, rows: [] });
    expect(d.tal.players).toEqual([]);
    for (const html of [d.card, d.podCard]) {
      expect(html).not.toContain("<u");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
      expect(text(html)).toContain("Leader||—");
      expect(text(html)).not.toContain("Most podiums");
    }
    expect(text(d.score)).toContain("No runs on this board yet.");
    expect(text(d.podiums)).toContain("No runs on this board yet.");
  });
});
