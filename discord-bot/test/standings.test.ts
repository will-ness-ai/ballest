// The standings image's layout, read from the scene before it is drawn. How it looks is checked
// by eye (`pnpm render:samples`); what each row says is something a test can hold it to.
import { describe, expect, it } from "vitest";
import { NO_SKIN_PICTURES } from "../src/render/art.js";
import { type El, standingsScene } from "../src/render/scenes.js";

const textsOf = (el: El): Array<string> =>
  (el.props.children ?? []).flatMap((c) =>
    c === null ? [] : typeof c === "string" ? [c] : textsOf(c),
  );

type Image = Parameters<typeof standingsScene>[0];
const NO_OVERALL: Image["overall"] = { rows: [], out: [] };

const scene = (board: Image["boards"][number]) =>
  textsOf(
    standingsScene(
      { title: "Daily Report", subtitle: "", boards: [board], overall: NO_OVERALL },
      NO_SKIN_PICTURES,
    ),
  );
const overallScene = (overall: Image["overall"]) =>
  textsOf(
    standingsScene({ title: "Daily Report", subtitle: "", boards: [], overall }, NO_SKIN_PICTURES),
  );

/** Every marble's hue in the scene, in drawing order (a player's hue marble included). */
const huesOf = (el: El): Array<number> =>
  el.type === "img"
    ? [
        ...Buffer.from((el.props.src ?? "").split(",")[1] ?? "", "base64")
          .toString()
          .matchAll(/hsl\((\d+),94%/g),
      ].map((m) => Number(m[1]))
    : (el.props.children ?? []).flatMap((c) =>
        c === null || typeof c === "string" ? [] : huesOf(c),
      );

/** Every element in the scene that `keep` picks. */
const findAll = (el: El, keep: (el: El) => boolean): Array<El> => [
  ...(keep(el) ? [el] : []),
  ...(el.props.children ?? []).flatMap((c) =>
    c === null || typeof c === "string" ? [] : findAll(c, keep),
  ),
];

const BOARD = (title: string): Image["boards"][number] => ({ title, rows: [], out: [] });
const FOUR = ["Most Maps played", "Most Author Medals", "Most world records", "Most Daily wins"];

describe("the standings image", () => {
  it("shows a row's move after its place and its gain before its number", () => {
    const texts = scene({
      title: "Most world records",
      rows: [
        { steamId: "s-Amy", skin: null, name: "Amy", n: 4, place: 1, move: 2, gain: 3 },
        { steamId: "s-Bob", skin: null, name: "Bob", n: 2, place: 2, move: "new", gain: -1 },
        { steamId: "s-Cy", skin: null, name: "Cy", n: 2, place: 2, move: 0, gain: 0 },
      ],
      out: [],
    });
    // Bob and Cy are level, so they share second
    expect(texts).toEqual([
      "Daily Report",
      "",
      "Overall",
      "10 points for 1st on a standing down to 1 for 10th, added across all four",
      "Nobody yet",
      "Most world records",
      ...["1", "2", "Amy", "+3", "4"],
      ...["2", "NEW", "Bob", "−1", "2"],
      ...["2", "Cy", "2"],
    ]);
  });

  it("puts who left the top 10 under the board, in place of 'Nobody yet'", () => {
    const texts = scene({ title: "Most top 5s", rows: [], out: ["Low5ive"] });
    expect(texts.slice(-3)).toEqual(["–", "OUT", "Low5ive"]);
    expect(texts.slice(texts.indexOf("Most top 5s"))).not.toContain("Nobody yet");
  });

  it("heads the image with Overall: each row's places on the four boards, then its points", () => {
    const texts = overallScene({
      rows: [
        {
          steamId: "s-Slati",
          skin: null,
          name: "Slati Jnr",
          points: 39,
          place: 1,
          move: 0,
          places: [1, 1, 2, 1],
        },
        {
          steamId: "s-Amy",
          skin: null,
          name: "Amy",
          points: 10,
          place: 2,
          move: "new",
          places: [null, null, 1, null],
        },
      ],
      out: ["Bob"],
    });
    expect(texts.slice(2)).toEqual([
      "Overall",
      "10 points for 1st on a standing down to 1 for 10th, added across all four",
      // no board letters: a place is a number on its board's marble, outside a top 10 nothing
      ...["1", "Slati Jnr", "1", "1", "2", "1", "39", "pts"],
      ...["2", "NEW", "Amy", "1", "10", "pts"],
      ...["–", "OUT", "Bob"],
    ]);
  });

  it("leads each of the four boards' titles with a marble in its own colour", () => {
    const el = standingsScene(
      { title: "", subtitle: "", boards: FOUR.map(BOARD), overall: NO_OVERALL },
      NO_SKIN_PICTURES,
    );
    const hues = huesOf(el);
    expect(hues).toHaveLength(4);
    expect(new Set(hues).size).toBe(4);
  });

  it("draws each Overall place on a marble in its board's colour, an empty socket outside a top 10", () => {
    const row = (places: Array<number | null>) => ({
      steamId: "s-Amy",
      skin: null,
      name: "Amy",
      points: 1,
      place: 1,
      move: 0 as const,
      places,
    });
    const keyed = standingsScene(
      { title: "", subtitle: "", boards: FOUR.map(BOARD), overall: NO_OVERALL },
      NO_SKIN_PICTURES,
    );
    const key = huesOf(keyed);
    const overall = (places: Array<number | null>) =>
      huesOf(
        standingsScene(
          { title: "", subtitle: "", boards: [], overall: { rows: [row(places)], out: [] } },
          NO_SKIN_PICTURES,
        ),
      );
    // the player's own marble comes first; then one marble per place, in its board's colour
    expect(overall([4, 5, 6, 7]).slice(-4)).toEqual(key);
    expect(overall([null, 5, null, 7]).slice(-2)).toEqual([key[1], key[3]]);
  });

  it("rings a podium place in its medal's colour", () => {
    const el = standingsScene(
      {
        title: "",
        subtitle: "",
        boards: [],
        overall: {
          rows: [
            {
              steamId: "s",
              skin: null,
              name: "A",
              points: 1,
              place: 1,
              move: 0,
              places: [1, 2, 3, 4],
            },
          ],
          out: [],
        },
      },
      NO_SKIN_PICTURES,
    );
    const rings = findAll(el, (e) =>
      String(e.props.style?.border ?? "").startsWith("2px solid #"),
    ).map((e) => e.props.style?.border);
    expect(rings).toEqual(["2px solid #ffd447", "2px solid #d3dcea", "2px solid #ef9a52"]);
  });
});
