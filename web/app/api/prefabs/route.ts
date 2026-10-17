// GET /api/prefabs: how many of their hourly uploads the signed-in reader has left, for the
// upload form. POST /api/prefabs: the upload form (db/prefab-api.ts). Never cached.
import { connection } from "next/server";

import { prefabDeps } from "../../../db/data";
import { uploadPrefab, uploadQuota } from "../../../db/prefab-api";

export async function GET(request: Request) {
  await connection();
  return uploadQuota(request, prefabDeps());
}

export async function POST(request: Request) {
  await connection();
  return uploadPrefab(request, prefabDeps());
}
