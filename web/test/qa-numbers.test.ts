import { describe, expect, it } from "vitest";

import { onlyNumbers } from "../scripts/qa/numbers.mjs";

// qa check's changed views where only the numbers moved: the preview and production read one
// database, but their caches can be a Refresh apart, so play counts, ranks and times drift
// with no change to the code. A view's text layout is each line of text with its box.
const line = (text: string, x: number, y: number, w = 100, h = 20) => ({ text, x, y, w, h });

describe("onlyNumbers", () => {
  it("is true when every line keeps its text, its digits aside, and its place", () => {
    const was = [line("Players", 0, 0), line("1,204 players", 0, 30, 110), line("0:10.267", 0, 60)];
    const is = [line("Players", 0, 0), line("1,207 players", 0, 30, 112), line("0:10.198", 0, 60)];
    expect(onlyNumbers(was, is)).toBe(true);
  });

  it("reads ordinals as numbers", () => {
    expect(onlyNumbers([line("1st", 0, 0)], [line("12th", 0, 0, 120)])).toBe(true);
  });

  it("is false when a word changed", () => {
    expect(onlyNumbers([line("Season 2", 0, 0)], [line("Season 2 Overall", 0, 0)])).toBe(false);
  });

  it("is false when a line without numbers moved or changed size", () => {
    const was = [line("3 runs", 0, 0), line("Maps", 0, 30)];
    expect(onlyNumbers(was, [line("4 runs", 0, 0), line("Maps", 0, 36)])).toBe(false);
    expect(onlyNumbers(was, [line("4 runs", 0, 0), line("Maps", 0, 30, 140)])).toBe(false);
  });

  it("is false when a line with a number moved down or grew taller", () => {
    const was = [line("3 runs", 0, 0), line("Maps", 0, 30)];
    expect(onlyNumbers(was, [line("4 runs", 0, 8), line("Maps", 0, 30)])).toBe(false);
    expect(onlyNumbers(was, [line("4 runs", 0, 0, 100, 40), line("Maps", 0, 30)])).toBe(false);
  });

  it("allows a pixel of rounding", () => {
    const was = [line("3 runs", 0, 0), line("Maps", 0, 30)];
    expect(onlyNumbers(was, [line("4 runs", 0, 0), line("Maps", 1, 31, 101)])).toBe(true);
  });

  it("is false when lines came or went", () => {
    expect(onlyNumbers([line("a", 0, 0)], [line("a", 0, 0), line("b", 0, 30)])).toBe(false);
  });

  it("is false when nothing is known about a side", () => {
    expect(onlyNumbers(undefined, [line("a", 0, 0)])).toBe(false);
  });

  it("is false when the text is the same throughout, as a style change is", () => {
    expect(onlyNumbers([line("12", 0, 0)], [line("12", 0, 0)])).toBe(false);
  });
});
