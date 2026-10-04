import { expect, test } from "vitest";

import { authorized } from "../app/api/revalidate/auth";

test("the revalidate route takes only the shared secret as a bearer token", () => {
  expect(authorized("Bearer s3cret", "s3cret")).toBe(true);
  expect(authorized("Bearer wrong", "s3cret")).toBe(false);
  expect(authorized("Bearer s3cre", "s3cret")).toBe(false);
  expect(authorized("s3cret", "s3cret")).toBe(false);
  expect(authorized(null, "s3cret")).toBe(false);
});

test("with no secret configured nothing is authorized", () => {
  expect(authorized("Bearer ", undefined)).toBe(false);
  expect(authorized("Bearer ", "")).toBe(false);
  expect(authorized("Bearer undefined", undefined)).toBe(false);
});
