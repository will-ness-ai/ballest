// `pnpm --silent campaign`'s pure half (scripts/campaign/draft.ts): the draft's title and
// slug, each Map's label and flags, and the entry it writes.
import { describe, expect, test } from "vitest";

import { type Campaign } from "../lib/campaigns";
import {
  cell,
  entryText,
  type Found,
  insertEntry,
  plan,
  rows,
  sharedTitle,
  slugOf,
} from "../scripts/campaign/draft";

const found = (pfid: string, title: string, extra: Partial<Found> = {}): Found => ({
  pfid,
  title,
  creator: "DanielProp",
  cid: "76561198042310114",
  created: 0,
  on_site: true,
  ...extra,
});

const draft = (title: string, maps: Array<Found>): Campaign => ({
  slug: slugOf(title),
  title,
  creator: "DanielProp",
  creatorId: "76561198042310114",
  maps: maps.map((m) => m.pfid),
});

describe("the draft's name", () => {
  test("is the words every title starts with", () => {
    expect(sharedTitle(["Limbo campaign 1 of 8", "Limbo campaign A08 of 8"])).toBe(
      "Limbo campaign",
    );
    expect(sharedTitle(["stoxy's mini golf 001", "Stoxy's Mini Golf 002"])).toBe(
      "stoxy's mini golf",
    );
    expect(sharedTitle(["Hydro - 1", "Hydro - 2"])).toBe("Hydro");
    expect(sharedTitle(["Mercury", "Venus"])).toBeNull();
  });

  test("makes a slug of lowercase words joined by -", () => {
    expect(slugOf("Stoxy's mini golf")).toBe("stoxys-mini-golf");
    expect(slugOf("Limbo campaign")).toBe("limbo");
    expect(slugOf("Tilted Campaign")).toBe("tilted");
    expect(slugOf("  AVG Circuit! ")).toBe("avg-circuit");
  });
});

describe("each Map's row", () => {
  test("carries its label, what stops the entry and what to look at", () => {
    const maps = [
      found("1", "Solar Trials Mercury"),
      found("2", "Solar Trials Venus", { creator: "Other", cid: "7656119" }),
      found("3", "Solar Trials Mars", { on_site: false }),
      // a Map Limbo campaign has
      found("3820698656", "Solar Trials Pluto"),
      found("5", "Solar Trials 5 of 5"),
    ];
    const r = rows(draft("Solar Trials", maps), maps);
    expect(r.map((x) => [x.no, x.label, x.problems, x.notes])).toEqual([
      ["01", "01 Mercury", [], []],
      ["02", "02 Venus", [], ["by Other"]],
      ["03", "03 Mars", [], ["not on the site yet"]],
      ["04", "04 Pluto", ["in limbo"], []],
      ["05", "05", [], []],
    ]);
  });

  test("flags a label that says its number twice", () => {
    const maps = [found("1", "Run 1st try"), found("2", "Run 2")];
    expect(rows(draft("Run", maps), maps).map((x) => x.notes)).toEqual([
      ["label repeats its number"],
      [],
    ]);
  });
});

describe("the entry", () => {
  test("is written the way Prettier lays it out", () => {
    const short = draft("Run", [found("3821644937", "Run 1")]);
    expect(entryText(short)).toBe(
      [
        "  {",
        '    slug: "run",',
        '    title: "Run",',
        '    creator: "DanielProp",',
        '    creatorId: "76561198042310114",',
        '    maps: ["3821644937"],',
        "  },",
      ].join("\n"),
    );
    const long = draft(
      "Run",
      ["1", "2", "3", "4", "5", "6", "7", "8"].map((n) => found(`382164493${n}`, `Run ${n}`)),
    );
    expect(entryText(long)).toContain('    maps: [\n      "3821644931",\n');
  });

  test("goes at the end of CAMPAIGNS", () => {
    const source =
      'const A = 1;\nexport const CAMPAIGNS = [\n  { slug: "a" },\n];\n\nexport const B = [\n];\n';
    expect(insertEntry(source, '  { slug: "b" },')).toBe(
      'const A = 1;\nexport const CAMPAIGNS = [\n  { slug: "a" },\n  { slug: "b" },\n];\n\nexport const B = [\n];\n',
    );
    expect(insertEntry("const A = [\n];", "x")).toBeNull();
  });
});

test("a cell is quoted when it holds a comma, a colon or a quote", () => {
  expect(cell("Limbo campaign 1 of 8")).toBe("Limbo campaign 1 of 8");
  expect(cell("Run: 1, 2")).toBe('"Run: 1, 2"');
});

describe("the plan", () => {
  const limbo = ["3820698656", "3820723299"].map((p, i) =>
    found(p, `Limbo campaign ${String(i + 1)} of 8`),
  );
  const fresh = [found("1", "Run 1"), found("2", "Run 2", { on_site: false })];

  test("names the Campaign from its Maps' titles, made by whoever made most of them", () => {
    const p = plan([...fresh, found("3", "Run 3", { creator: "Other", cid: "7656119" })], [], {});
    expect(p.kind === "draft" && [p.campaign.slug, p.campaign.title, p.campaign.creator]).toEqual([
      "run",
      "Run",
      "DanielProp",
    ]);
    expect(plan([found("1", "Mercury"), found("2", "Venus")], [], {})).toEqual({
      kind: "untitled",
    });
  });

  test("is a no-op for Maps that are a Campaign already", () => {
    const list = [{ ...draft("Limbo", limbo), slug: "limbo" }];
    expect(plan(limbo, [], {}, list)).toEqual({ kind: "added", campaign: list[0] });
  });

  test("stops on a Map another Campaign has or a taken slug, and only notes the rest", () => {
    const list = [{ ...draft("Run", [found("9", "x")]), creatorId: "76561198042310114" }];
    const p = plan([...fresh, found("3820698656", "Run 3")], ["42"], { slug: "run" }, list);
    if (p.kind !== "draft") throw new Error(p.kind);
    expect(p.problems).toEqual(["03 3820698656: in limbo", 'slug "run" is Run\'s']);
    expect(p.slugTaken).toBe(true);
    expect(p.notes).toEqual([
      "42: no Map (not this game's, not public, or newer than Steam's catalogue)",
      "02 2: not on the site yet",
      "DanielProp also made run: share their creator fields as a constant",
    ]);
    const clean = plan(fresh, [], {}, []);
    expect(clean.kind === "draft" && [clean.problems, clean.notes.length]).toEqual([[], 1]);
  });
});
