import { describe, expect, it } from "vitest";

import { numberLines } from "../scripts/qa/numbers.mjs";

// qa check's changed views where only the numbers moved: the preview and production read one
// database, but their caches can be a Refresh apart, so play counts, ranks and times drift
// with no change to the code. A view's text layout is each line of text with its box.
const line = (text: string, x: number, y: number, w = 100, h = 20) => ({ text, x, y, w, h });

describe("numberLines", () => {
  it("gives the boxes of the lines whose numbers changed, both sides, padded", () => {
    const was = [line("Players", 0, 0), line("1,204 players", 0, 30, 110), line("0:10.267", 0, 60)];
    const is = [line("Players", 0, 0), line("1,207 players", 0, 30, 112), line("0:10.198", 0, 60)];
    expect(numberLines(was, is)).toEqual([
      [-2, 28, 112, 52],
      [-2, 28, 114, 52],
      [-2, 58, 102, 82],
      [-2, 58, 102, 82],
    ]);
  });

  it("reads ordinals as numbers", () => {
    expect(numberLines([line("1st", 0, 0)], [line("12th", 0, 0, 120)])).not.toBeNull();
  });

  it("is null when a word changed", () => {
    expect(numberLines([line("Season 2", 0, 0)], [line("Season 2 Overall", 0, 0)])).toBeNull();
  });

  it("is null when a line whose text stayed moved or changed size, numbers or not", () => {
    const was = [line("3 runs", 0, 0), line("Maps", 0, 30), line("0:10.267", 0, 60)];
    const runs = line("4 runs", 0, 0);
    expect(numberLines(was, [runs, line("Maps", 0, 36), line("0:10.267", 0, 60)])).toBeNull();
    expect(numberLines(was, [runs, line("Maps", 0, 30, 140), line("0:10.267", 0, 60)])).toBeNull();
    // a times column set right: the same times, somewhere else
    expect(numberLines(was, [runs, line("Maps", 0, 30), line("0:10.267", 80, 60)])).toBeNull();
  });

  it("lets a line on the same row as a changed number move along with it", () => {
    const was = [line("3 runs", 0, 0, 50), line("today", 50, 0, 40)];
    const is = [line("12 runs", 0, 0, 60), line("today", 60, 0, 40)];
    expect(numberLines(was, is)).toContainEqual([58, -2, 102, 22]);
    // but not one on a row where no number changed
    const below = [line("3 runs", 0, 0, 50), line("today", 50, 30, 40)];
    expect(numberLines(below, [is[0], line("today", 60, 30, 40)])).toBeNull();
  });

  it("is null when a line with a changed number moved down or grew taller", () => {
    const was = [line("3 runs", 0, 0), line("Maps", 0, 30)];
    expect(numberLines(was, [line("4 runs", 0, 8), line("Maps", 0, 30)])).toBeNull();
    expect(numberLines(was, [line("4 runs", 0, 0, 100, 40), line("Maps", 0, 30)])).toBeNull();
  });

  it("allows a pixel of rounding", () => {
    const was = [line("3 runs", 0, 0), line("Maps", 0, 30)];
    expect(numberLines(was, [line("4 runs", 0, 0), line("Maps", 1, 31, 101)])).not.toBeNull();
  });

  it("is null when lines came or went", () => {
    expect(numberLines([line("a", 0, 0)], [line("a", 0, 0), line("b", 0, 30)])).toBeNull();
  });

  it("is null when nothing is known about a side", () => {
    expect(numberLines(undefined, [line("a", 0, 0)])).toBeNull();
  });

  it("is null when the text is the same throughout, as a style change is", () => {
    expect(numberLines([line("12", 0, 0)], [line("12", 0, 0)])).toBeNull();
  });
});
