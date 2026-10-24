// PUT /api/me/skin with { skin }: the signed-in player saves their Chosen Skin; DELETE clears
// it (db/chosen-skin-api.ts). Never cached.
import { connection } from "next/server";

import { chooseSkin } from "../../../../db/chosen-skin-api";
import { chosenSkinDeps } from "../../../../db/data";

export async function PUT(request: Request) {
  await connection();
  return chooseSkin(request, chosenSkinDeps());
}

export async function DELETE(request: Request) {
  await connection();
  return chooseSkin(request, chosenSkinDeps());
}
