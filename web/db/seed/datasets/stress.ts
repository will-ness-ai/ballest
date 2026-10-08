// tiny, plus the data that strains a layout: a player with a long name holding a five-digit
// rank, and a Map with a long title. `pnpm qa` checks a local build seeded with it
// (scripts/qa/catalogue.mjs names these IDs); tiny's own rows are untouched, so every page
// tiny's comments describe still reads the same, with more players below on the Overall board.
import {
  boardReads,
  boards,
  entries,
  mapHistory,
  maps,
  personaHistory,
  players,
} from "../../schema";
import { tiny } from "./tiny";
import type { Dataset } from "./types";

const OVERALL = "OverallLeaderboard_EASeason2";
const TRACK = "Map_Track13";
const MAP = "Workshop_9000000005";
// below tiny's 300 points, so each filler player and then p11 sit under tiny's four
const FILLERS = 12_000;
const LONG = "Twizzle #ROLLEMALL #LongLiveTheMarble";
const TITLE = "Rocky Alpine but backwards or something like that";

const id = (n: number) => `7656119900${String(n).padStart(7, "0")}`;

export const stress: Dataset = {
  description: `tiny, plus ${String(FILLERS)} Overall players, a long name at a five-digit rank and a long Map title`,
  seed: async (tx) => {
    await tiny.seed(tx);
    const r3 = 3;
    const p11 = id(11);
    const filler = Array.from({ length: FILLERS }, (_, i) => id(100 + i));
    const all = [...filler, p11];
    for (let i = 0; i < all.length; i += 1000) {
      const chunk = all.slice(i, i + 1000);
      await tx.insert(players).values(
        chunk.map((steamId) => ({
          steamId,
          persona: steamId === p11 ? LONG : `Filler ${steamId.slice(-5)}`,
          avatar: null,
          profileUrl: `https://steamcommunity.com/profiles/${steamId}/`,
        })),
      );
      await tx.insert(personaHistory).values(
        chunk.map((steamId) => ({
          steamId,
          persona: steamId === p11 ? LONG : `Filler ${steamId.slice(-5)}`,
          firstSeenRefresh: r3,
          lastSeenRefresh: r3,
        })),
      );
      await tx.insert(entries).values(
        chunk.map((steamId, j) => ({
          board: OVERALL,
          steamId,
          // 299 points down to 0 across the fillers; p11 last, on 0
          score: steamId === p11 ? 0 : Math.max(1, 299 - Math.floor(((i + j) * 299) / FILLERS)),
          ugcId: `9100000000${String(i + j)}`,
          firstSeenRefresh: r3,
          lastSeenRefresh: r3,
          closedRefresh: null,
        })),
      );
    }
    await tx.insert(boards).values({
      name: MAP,
      kind: "map",
      display: TITLE,
      leaderboardId: 90000005,
      scoresPoints: false,
    });
    await tx.insert(boardReads).values({ refreshId: r3, board: MAP, ok: true, entryCount: 2 });
    await tx.insert(entries).values([
      {
        board: MAP,
        steamId: p11,
        score: 7_654_321,
        ugcId: "9200000001",
        firstSeenRefresh: r3,
        lastSeenRefresh: r3,
        closedRefresh: null,
      },
      {
        board: MAP,
        steamId: id(1),
        score: 7_900_000,
        ugcId: "9200000002",
        firstSeenRefresh: r3,
        lastSeenRefresh: r3,
        closedRefresh: null,
      },
      {
        board: TRACK,
        steamId: p11,
        score: 1_234_567,
        ugcId: "9200000003",
        firstSeenRefresh: r3,
        lastSeenRefresh: r3,
        closedRefresh: null,
      },
    ]);
    await tx.insert(maps).values({
      pfid: "9000000005",
      board: MAP,
      creatorSteamId: p11,
      createdAt: new Date("2026-08-31T18:00:00Z"),
    });
    await tx.insert(mapHistory).values({
      pfid: "9000000005",
      title: TITLE,
      creator: LONG,
      preview: "https://images.example.invalid/rocky.jpg",
      medals: [120, 95, 88, 80.5],
      sessions: 40,
      subs: 31,
      entryCount: 2,
      firstSeenRefresh: r3,
      lastSeenRefresh: r3,
    });
  },
};
