// What each image draws for a player's marble: their Chosen Skin's picture when they have one,
// their hue marble otherwise. The scenes are element trees, so a marble is an image whose source
// is either the picture or a drawn marble in the player's hue.
import { describe, expect, it } from "@effect/vitest";
import { hueFor } from "../src/render/art.js";
import type { PbEvent } from "../src/domain.js";
import type { Improvement, ProfilePreview } from "../src/ports.js";
import {
  cardScene,
  type El,
  improvementScene,
  linkScene,
  progressionScene,
  standingsScene,
} from "../src/render/scenes.js";
import { ALICE, BOB, cardView, drawnMap, ticks } from "./harness.js";

const PICTURE = "data:image/png;base64,QUxJQ0UnUyBTS0lO";
/** Alice picked a Skin; Bob didn't. */
const looks = (steamId: string) => (steamId === ALICE.steamId ? PICTURE : null);

/** Every image source in a scene, SVGs decoded. */
const sources = (el: El): Array<string> => [
  ...(el.type === "img" && el.props.src !== undefined ? [decoded(el.props.src)] : []),
  ...(el.props.children ?? []).flatMap((c) =>
    c === null || typeof c === "string" ? [] : sources(c),
  ),
];
const decoded = (src: string) =>
  src.startsWith("data:image/svg+xml;base64,")
    ? Buffer.from(src.slice(src.indexOf(",") + 1), "base64").toString()
    : src;

/** How many of a scene's images are the picture, and whether a player's hue marble is drawn. */
const pictures = (el: El) => sources(el).filter((s) => s === PICTURE).length;
const drawsHueMarble = (el: El, steamId: string) =>
  sources(el).some((s) => s.includes(`stop-color="hsl(${hueFor(steamId)},94%,90%)"`));

const names = new Map([
  [ALICE.discordId, "Alice"],
  [BOB.discordId, "Bob"],
]);
const live = cardView("m1", {
  state: "live",
  type: "lobby",
  players: [ALICE, BOB],
  map: drawnMap(),
  standings: [
    { player: ALICE, ticks: ticks(19), rank: 1, medal: "author" },
    { player: BOB, ticks: ticks(24), rank: 2, medal: "gold" },
  ],
});

const improvement = (player: typeof ALICE, beatWorldRecord: number | null): Improvement => ({
  player,
  ticks: ticks(14.59),
  medal: "gold",
  rank: 1,
  previousTicks: ticks(17.2),
  previousRank: 2,
  beatWorldRecord,
});
const preview = (steamId: string): ProfilePreview => ({
  steamId,
  personaName: "Someone",
  avatarUrl: "",
  campaignTracks: 21,
  campaignTrackTotal: 23,
});
const history: ReadonlyArray<PbEvent> = [
  { at: 60_000, steamId: ALICE.steamId, ticks: ticks(19) },
  { at: 90_000, steamId: BOB.steamId, ticks: ticks(24) },
];
const row = (steamId: string, name: string, place: number) => ({
  steamId,
  name,
  n: 10 - place,
  place,
  move: 0,
  gain: 0,
});

/** A scene drawing one player's marble, for each image that draws one. */
const scenes: ReadonlyArray<readonly [string, (who: typeof ALICE) => El]> = [
  ["an Improvement row", (who) => improvementScene(improvement(who, null), "Name", looks)],
  ["a world record's row", (who) => improvementScene(improvement(who, ticks(15)), "Name", looks)],
  ["the Link confirmation", (who) => linkScene(preview(who.steamId), looks)],
];

describe("a player's marble", () => {
  it("on the Card is their Chosen Skin, or their hue marble without one", () => {
    const scene = cardScene({ view: live, names, preview: null }, looks);
    expect(pictures(scene)).toBe(1);
    expect(drawsHueMarble(scene, ALICE.steamId)).toBe(false);
    expect(drawsHueMarble(scene, BOB.steamId)).toBe(true);
  });

  for (const [name, draw] of scenes)
    it(`on ${name} is their Chosen Skin, or their hue marble without one`, () => {
      expect(pictures(draw(ALICE))).toBe(1);
      expect(drawsHueMarble(draw(ALICE), ALICE.steamId)).toBe(false);
      expect(pictures(draw(BOB))).toBe(0);
      expect(drawsHueMarble(draw(BOB), BOB.steamId)).toBe(true);
    });

  it("in the progression graph's legend is their Chosen Skin, or their hue marble", () => {
    const final = cardView("m1", {
      state: "finished",
      type: "lobby",
      players: [ALICE, BOB],
      map: drawnMap(),
      standings: [
        { player: ALICE, ticks: ticks(19), rank: 1, medal: "author" },
        { player: BOB, ticks: ticks(24), rank: 2, medal: "gold" },
      ],
    });
    const scene = progressionScene({ view: final, history, names }, looks);
    expect(pictures(scene)).toBe(1);
    expect(drawsHueMarble(scene, ALICE.steamId)).toBe(false);
    expect(drawsHueMarble(scene, BOB.steamId)).toBe(true);
  });

  it("on the Daily Report's boards is their Chosen Skin, or their hue marble", () => {
    const scene = standingsScene(
      {
        title: "Daily Report",
        subtitle: "",
        boards: [
          {
            title: "Most played",
            rows: [row(ALICE.steamId, "Alice", 1), row(BOB.steamId, "Bob", 2)],
            out: [],
          },
          { title: "Most authors", rows: [row(ALICE.steamId, "Alice", 1)], out: [] },
        ],
      },
      looks,
    );
    expect(pictures(scene)).toBe(2);
    expect(drawsHueMarble(scene, ALICE.steamId)).toBe(false);
    expect(drawsHueMarble(scene, BOB.steamId)).toBe(true);
  });
});
