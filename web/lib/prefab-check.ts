// The upload check, run in the browser for instant feedback and again on the server: the
// same rules the game's spawnprefab applies (read from its error messages). A BallestPrefab
// version 1 file of 2 to 4096 pieces, each a real level-editor piece and never the start
// piece, at most 4 MB.

export const MAX_BYTES = 4 * 1024 * 1024;

/* every piece the editor's content browser offers, by blueprint name */
const PIECES = new Set([
  "BP_AirVent",
  "BP_Bevel_Full_Cap",
  "BP_Bowl_RingScoop",
  "BP_Checkpoint",
  "BP_Misc_Pinched1",
  "BP_Pipe_Half1",
  "BP_Pipe_Half_Large1",
  "BP_Pipe_Half_Tiny1",
  "BP_Pipe_Quarter_Large",
  "BP_Pipe_Quarter_Small",
  "BP_Pipe_Quarter_Straight",
  "BP_Pipe_Tube1",
  "BP_Prim_Cube",
  "BP_Prim_Cylinder",
  "BP_Prim_Sphere",
  "BP_Ramp_Curve1",
  "BP_Ramp_Curve2",
  "BP_Ramp_Curve_Long1",
  "BP_Ramp_Curve_Long2",
  "BP_Ramp_Curve_Short1",
  "BP_Ramp_Curve_Short2",
  "BP_Ramp_Kicker1",
  "BP_Ramp_Kicker1_Short",
  "BP_Ramp_Kicker2",
  "BP_Ramp_Kicker2_Short",
  "BP_Ramp_Round_CurveDown",
  "BP_Ramp_Round_CurveUp",
  "BP_Track_Curve1",
  "BP_Track_Curve_Large1",
  "BP_Track_Curve_Tiny1",
  "BP_Track_Long1",
  "BP_Track_Mid1",
  "BP_Track_Round_Curve",
  "BP_Track_Round_Straight",
  "BP_Track_Short1",
  "Bevel_Arch",
  "Bevel_Bumper",
  "Bevel_BumperLongDouble",
  "Bevel_BumperLongSingle",
  "Bevel_Full_Branch",
  "Bevel_Full_HalfRingKicker",
  "Bevel_Full_Kicker",
  "Bevel_Full_MediumScoop",
  "Bevel_Full_Ring",
  "Bevel_Full_RingScoop",
  "Bevel_Full_ShallowKicker",
  "Bevel_Full_ShallowScoop",
  "Bevel_Full_ShallowShortScoop",
  "Bevel_Full_ShallowSideKicker_L",
  "Bevel_Full_ShallowSideKicker_R",
  "Bevel_Full_ShortScoop",
  "Bevel_Full_ShortUScoop_L",
  "Bevel_Full_ShortUScoop_R",
  "Bevel_Full_Straight",
  "Bevel_Full_StubKicker",
  "Bevel_Full_Turn",
  "Bevel_Half_Cap",
  "Bevel_Half_ConcaveCornerCurveFlat",
  "Bevel_Half_ConvexCornerCurveFlat",
  "Bevel_Half_CornerStraight",
  "Bevel_Half_DeepCornerScoop",
  "Bevel_Half_Platform",
  "Bevel_Half_SSurveL",
  "Bevel_Half_SSurveR",
  "Bevel_Half_ShallowCornerHump",
  "Bevel_Half_ShallowCornerScoop",
  "Bevel_Half_SteepCornerHump",
  "Bevel_Half_Straight",
  "Bevel_Half_TightConcaveCornerCurveFlat",
  "Bevel_Half_Turn",
  "Bevel_Rail",
  "Bevel_Tall_Branch",
  "Bevel_Tall_Cap",
  "Bevel_Tall_CornerConcave",
  "Bevel_Tall_CornerStraight",
  "Bevel_Tall_Podium",
  "Bevel_Tall_Ring",
  "Bevel_Tall_SheerStraight",
  "Bevel_Tall_StraightPlatform",
  "Bevel_Tall_StraightWall",
  "MP_ActualCheckpoint_Strip",
  "MP_Cone",
  "MP_FlatGlassPlane",
  "MP_FlatRing",
  "MP_Pyramid",
  "MP_RoundedBumper",
  "MP_RoundedGlassPlane1",
  "MP_RoundedTorus",
  "MP_SM_ConeBowl",
  "MP_SM_CornerScoop",
  "MP_SM_FullMediumBowl",
  "MP_SM_HalfShallowHoleBowl",
  "MP_SM_Hole",
  "MP_SM_QuarterMediumBowl",
  "MP_SM_QuarterShallowHoleBowl",
  "MP_ShallowBowlV2",
  "MP_TunnelHalf",
  "RubberBlock",
  "RubberBlock2_M_PlasticBase",
  "RubberCylinder",
]);

export type Check = { ok: true; pieces: number } | { ok: false; problems: Array<string> };

export function checkPrefab(text: string): Check {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    return { ok: false, problems: ["The file is over 4 MB."] };
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["This isn't a JSON file."] };
  }
  const f = file as { format?: unknown; version?: unknown; group?: unknown; items?: unknown };
  const problems: Array<string> = [];
  if (f.format !== "BallestPrefab")
    problems.push('It isn\'t a prefab: "format" should be "BallestPrefab".');
  else if (f.version !== 1)
    problems.push("It's a prefab version this site doesn't know yet (only version 1).");
  if (typeof f.group !== "object" || f.group === null)
    problems.push("Its group transform is missing.");
  const items = Array.isArray(f.items) ? (f.items as Array<{ class?: unknown }>) : null;
  if (!items) problems.push("It has no pieces.");
  else {
    if (items.length < 2) problems.push("A prefab needs at least 2 pieces.");
    if (items.length > 4096)
      problems.push(`It has ${items.length} pieces; the game takes at most 4096.`);
    const unknown = new Set<string>();
    let start = false;
    for (const it of items) {
      const name =
        typeof it.class === "string"
          ? (it.class.split(/[./]/).at(-1) ?? "").replace(/_C$/, "")
          : "";
      if (name === "MP_PlayerStart") start = true;
      else if (!PIECES.has(name)) unknown.add(name || "(no class)");
    }
    if (start) problems.push("It contains the start pad, which the game won't spawn in a prefab.");
    if (unknown.size)
      problems.push(
        `Pieces the editor doesn't have: ${[...unknown].slice(0, 3).join(", ")}${unknown.size > 3 ? "…" : ""}.`,
      );
  }
  return problems.length ? { ok: false, problems } : { ok: true, pieces: items?.length ?? 0 };
}

/* the name the game spawns it by: letters, digits, _ and -, 1 to 64 */
export function fileNameOf(name: string) {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return (stem || "prefab") + ".json";
}

/* a Prefab's link from its first name: lower case, every other run of characters a dash */
export function slugOf(name: string) {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return stem || "prefab";
}
