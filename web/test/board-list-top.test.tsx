// A board's list keeps its top three as rows, under the plates that show them too: readers
// skim the list for a name and miss the plates (a player's note, 2026-10-28). Track 13 of the
// tiny dataset ranks six, so it has plates and rows under them; Map A's three podium
// players make a podium order with plates; and a Daily's panel draws its podium steps over
// the same full list.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { BoardBody } from "../components/board/BoardBody";
import { PodiumPlates, ScorePlates } from "../components/board/BoardTop";
import { DayPanel } from "../components/daily/DayPanel";
import { seed } from "../db/seed/harness";
import { boardPage, mapPodiums } from "../db/site";
import { BOARD_CHUNK } from "../lib/rules";
import { podiumRows, tally } from "../lib/podiums";
import type { DailyDay } from "../lib/rows";
import { freshDb } from "./pg";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  await seed(t.db, "tiny");
});
afterAll(() => t.drop());

/* the ranks of the list's rows, in order, leaving out the plates above it */
const listRanks = (html: string) => {
  const list = html.slice(html.indexOf('id="board"'));
  return [...list.matchAll(/<span class="c-rank">(\d+)<\/span>/g)].map((m) => Number(m[1]));
};

const TRACK = "Map_Track13";
const MAP_A = "Workshop_9000000001";

describe("a board's list holds its podium too", () => {
  test("score order: the list starts at 1st, under the plates", async () => {
    const page = await boardPage(t.db, TRACK, { count: BOARD_CHUNK });
    expect(page.total).toBeGreaterThanOrEqual(4);
    const html = renderToStaticMarkup(
      <BoardBody
        order="score"
        name={TRACK}
        points={false}
        where="Tiny"
        count={page.total}
        leaders={<ScorePlates name={TRACK} rows={page.rows} focus={null} />}
        initial={page.rows}
        lead={page.rows[0]?.score ?? null}
        pods={null}
        focus={null}
      />,
    );
    expect(html).toContain('class="leaders"');
    expect(listRanks(html).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(html).toContain(`showing ${String(page.total)}`);
  });

  test("podium order: the list starts at 1st, under the plates", async () => {
    const tal = tally("Tiny", [MAP_A], await mapPodiums(t.db, [MAP_A]), () => "01");
    const players = podiumRows(tal, {});
    expect(players.length).toBeGreaterThanOrEqual(3);
    const html = renderToStaticMarkup(
      <BoardBody
        order="podiums"
        name="OverallCampaign_tiny"
        points
        where="Tiny"
        count={players.length}
        leaders={<PodiumPlates tally={tal} />}
        players={players}
        tracks={tal.tracks}
        group="Tiny"
      />,
    );
    expect(listRanks(html)).toEqual(players.map((p) => p.rank));
    expect(listRanks(html)[0]).toBe(1);
  });

  test("a Daily: the list under the podium steps starts at 1st", async () => {
    const page = await boardPage(t.db, TRACK, { count: BOARD_CHUNK });
    const d: DailyDay = {
      date: "2026-08-29",
      board: TRACK,
      pfid: "9000000001",
      title: "Map A",
      preview: null,
      medals: [],
      listed: false,
      startsAt: "2026-08-29T01:00:00Z",
      endsAt: "2026-08-30T01:00:00Z",
      final: true,
      entryCount: page.total,
    };
    const html = renderToStaticMarkup(<DayPanel d={d} rows={page.rows} />);
    expect(listRanks(html).slice(0, 4)).toEqual([1, 2, 3, 4]);
  });
});
