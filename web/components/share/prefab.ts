// A Prefab drawn for its share image: the scene and camera the gallery's stills use
// (components/prefabs/scene.ts), from the angle its uploader picked, through the GPU-free
// rasterizer.
import { PREFAB_PICTURE } from "./Card";
import { rasterize } from "./raster";
import { buildScene, loadThree, stillCamera } from "../prefabs/scene";
import type { PrefabFile } from "../../lib/prefab";
import type { PrefabAngle } from "../../lib/prefabs";

/* a Prefab's file drawn for its card, as a data: URL, or null when it can't be: the card is
   then drawn without it */
export async function prefabShot(file: string, angle: PrefabAngle | null) {
  try {
    const [w, h] = PREFAB_PICTURE;
    const png = await prefabPicture(JSON.parse(file) as PrefabFile, angle, w, h);
    return "data:image/png;base64," + png.toString("base64");
  } catch (e) {
    console.warn("share image: a Prefab not drawn", e);
    return null;
  }
}

/* the Prefab at `w` × `h` from `angle`, as a PNG clear around it */
export async function prefabPicture(
  file: PrefabFile,
  angle: PrefabAngle | null,
  w: number,
  h: number,
) {
  const three = await loadThree();
  const { scene, centre, radius } = buildScene(three, file, false);
  const camera = stillCamera(three.THREE, w / h, centre, radius, angle);
  return rasterize(three.THREE, scene, camera, w, h);
}
