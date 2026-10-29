/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: the three Trials, from a snapshot read from Steam on 2026-10-29.
import data from "../../lib/proto-trials.json";

export type Row = (typeof data)[number]["top"][number];
export interface Trial {
  board: string;
  title: string;
  players: number;
  top: Array<Row>;
  href: string;
  blurb: string;
  picture: string | null;
  status: string;
}
const EXTRA: Record<string, Pick<Trial, "href" | "blurb" | "picture" | "status">> = {
  Map_TheTower: {
    href: "/board/Map_TheTower",
    blurb: "The climb to the top, no checkpoints.",
    picture: null,
    status: "Open",
  },
  Map_TheTowerCP: {
    href: "/board/Map_TheTowerCP",
    blurb: "The same climb, with checkpoints.",
    picture: null,
    status: "Open",
  },
  Map_LethTrial_01: {
    href: "/campaign/leth-trials/leth-trial-1",
    blurb: "Lethamyr's one-off event board.",
    picture: "/leth/screenshot.jpg",
    status: "Closed",
  },
};
export const TRIALS: Array<Trial> = data.map((t) => ({ ...t, ...EXTRA[t.board] }));
