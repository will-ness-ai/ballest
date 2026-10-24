import { expect, test } from "vitest";

import { authorized } from "../app/api/revalidate/auth";
import { tagsToExpire } from "../app/api/revalidate/tags";
import { boardTag, DAILY_TAG, DATA_TAG } from "../db/tags";

test("the revalidate route takes only the shared secret as a bearer token", () => {
  expect(authorized("Bearer s3cret", "s3cret")).toBe(true);
  expect(authorized("Bearer wrong", "s3cret")).toBe(false);
  expect(authorized("Bearer s3cre", "s3cret")).toBe(false);
  expect(authorized("s3cret", "s3cret")).toBe(false);
  expect(authorized(null, "s3cret")).toBe(false);
});

test("whitespace around the secret, on either side, doesn't matter", () => {
  expect(authorized("Bearer s3cret", "s3cret\n")).toBe(true);
  expect(authorized("Bearer s3cret", " s3cret \r\n")).toBe(true);
  expect(authorized("Bearer s3cret ", "s3cret")).toBe(true);
  expect(authorized("Bearer s3cret", "s3cret x")).toBe(false);
});

test("with no secret configured nothing is authorized", () => {
  expect(authorized("Bearer ", undefined)).toBe(false);
  expect(authorized("Bearer ", "")).toBe(false);
  expect(authorized("Bearer ", " \n")).toBe(false);
  expect(authorized("Bearer undefined", undefined)).toBe(false);
});

test("a Refresh expires every read, and a Daily read only the Dailies' and its boards'", () => {
  expect(tagsToExpire(new URLSearchParams())).toEqual([DATA_TAG]);
  const board = "ballest_v0_1_Daily_20261006_0";
  expect(tagsToExpire(new URLSearchParams([["daily", board]]))).toEqual([
    DAILY_TAG,
    boardTag(board),
  ]);
});

test("a Daily read names only Daily boards", () => {
  expect(tagsToExpire(new URLSearchParams([["daily", "Map_Track13"]]))).toEqual([DAILY_TAG]);
});
