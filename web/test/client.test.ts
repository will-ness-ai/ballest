// The DB client's URL: the Neon integration's sslmode=require is named as the verify-full
// pg already reads it as, and nothing else in the URL changes. A pool connects on its first
// query, so none of these reach a database.
import { expect, test } from "vitest";

import { connect } from "../db/client";

const opened = async (url: string) => {
  const pool = connect(url).$client;
  await pool.end();
  return pool.options.connectionString;
};

test("a URL asking for sslmode=require asks for verify-full, wherever it sits", async () => {
  expect(await opened("postgres://u@h/db?sslmode=require")).toBe(
    "postgres://u@h/db?sslmode=verify-full",
  );
  expect(await opened("postgres://u@h/db?channel_binding=require&sslmode=require")).toBe(
    "postgres://u@h/db?channel_binding=require&sslmode=verify-full",
  );
  expect(await opened("postgres://u@h/db?sslmode=require&channel_binding=require")).toBe(
    "postgres://u@h/db?sslmode=verify-full&channel_binding=require",
  );
});

test("any other URL is opened as it is", async () => {
  for (const url of [
    "postgres://postgres:postgres@localhost:5432/ballest_dev",
    "postgres://u@h/db?sslmode=disable",
    "postgres://u@h/db?channel_binding=require",
  ])
    expect(await opened(url)).toBe(url);
});
