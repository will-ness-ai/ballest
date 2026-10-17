// The test database helper (test/pg.ts): when Postgres is down, one error that says how to
// start it, rather than every test failing as if the code under test were broken.
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("a Postgres that isn't running is named, with the command that starts it", async () => {
  vi.stubEnv("TEST_DATABASE_URL", "postgres://postgres:postgres@localhost:1/postgres");
  vi.resetModules();
  const { freshDb } = await import("./pg");
  await expect(freshDb()).rejects.toThrow(/localhost:1[\s\S]*service postgresql start/);
});
