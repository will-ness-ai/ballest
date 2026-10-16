// A Prefab as a three.js scene, shared
// by the live viewer and the list's still pictures.
import { shapesOf, type PrefabFile } from "../../lib/prefab";

type Three = typeof import("three");

export async function loadThree() {
  const THREE = await import("three");
  const { RoundedBoxGeometry } =
    await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
  return { THREE, RoundedBoxGeometry };
}

export function buildScene(
  { THREE, RoundedBoxGeometry }: Awaited<ReturnType<typeof loadThree>>,
  file: PrefabFile,
  grid = true,
) {
  const scene = new THREE.Scene();
  /* a key light and a fill from the other side, so no face is left to the sky light alone,
     which drew a sign's white letters grey and its red maroon from behind the key */
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30333d, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.6, 1, 0.4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 1.6);
  fill.position.set(-0.6, 0.5, -0.5);
  scene.add(fill);
  const geometry = {
    box: new RoundedBoxGeometry(1, 1, 1, 1, 0.01),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 40),
    sphere: new THREE.SphereGeometry(0.5, 32, 20),
    scoop: scoopGeometry(THREE),
    halfRing: ringGeometry(THREE, "half"),
    quarterRing: ringGeometry(THREE, "quarter"),
  };
  const group = new THREE.Group();
  for (const s of shapesOf(file)) {
    const mesh = new THREE.Mesh(
      geometry[s.kind],
      new THREE.MeshStandardMaterial({
        color: s.colour,
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(s.matrix);
    group.add(mesh);
  }
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  if (grid) {
    const size = Math.max(2, Math.ceil(radius * 1.6));
    const g = new THREE.GridHelper(size, size, 0x5a6280, 0x2c3248);
    g.position.set(centre.x, box.min.y - 0.001, centre.z);
    scene.add(g);
  }
  return { scene, centre, radius };
}

/* where the camera sits to fit the whole prefab, three-quarters from above */
export function framing(
  THREE: Three,
  camera: import("three").PerspectiveCamera,
  centre: import("three").Vector3,
  radius: number,
) {
  const v = (camera.fov * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * camera.aspect);
  const dist = (radius / Math.sin(Math.min(v, h))) * 1.05;
  return centre.clone().add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(dist));
}

/* one shared renderer draws every still, so a long list costs one WebGL context */
let shared: Promise<{
  three: Awaited<ReturnType<typeof loadThree>>;
  renderer: import("three").WebGLRenderer;
}> | null = null;
export async function stillOf(
  file: PrefabFile,
  w: number,
  h: number,
  /* a solid backdrop instead of a transparent one */
  background?: string,
): Promise<string> {
  shared ??= loadThree().then((three) => {
    const renderer = new three.THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    return { three, renderer };
  });
  const { three, renderer } = await shared;
  const { scene, centre, radius } = buildScene(three, file, false);
  const camera = new three.THREE.PerspectiveCamera(40, w / h, 0.05, 2000);
  camera.position.copy(framing(three.THREE, camera, centre, radius));
  camera.lookAt(centre);
  renderer.setSize(w, h, false);
  if (background) renderer.setClearColor(background, 1);
  renderer.render(scene, camera);
  if (background) renderer.setClearColor(0x000000, 0);
  return renderer.domElement.toDataURL("image/png");
}

/* SM_2000_45scoop stand-in: a slab whose top curves up from flat to 45 degrees along x */
function scoopGeometry(THREE: Three) {
  const shape = new THREE.Shape();
  const n = 16;
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    shape.lineTo(-0.5 + t, -0.5 + 0.12 + 0.88 * t * t);
  }
  shape.lineTo(-0.5, -0.5);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

/* the hole bowls' stand-in: a flat ring with a hole, cut to a half (Unreal y >= 0) or a quarter
   (x and y >= 0) around a centre on the bounds' edge, as SM_HalfShallowHoleBowl and
   SM_QuarterShallowHoleBowl are; the hole is 55% of the radius, read off a sign built from them */
function ringGeometry(THREE: Three, cut: "half" | "quarter") {
  const half = cut === "half";
  const sweep = half ? Math.PI : Math.PI / 2;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 1, 0, sweep, false);
  shape.absarc(0, 0, 0.55, sweep, 0, true);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, curveSegments: 48, bevelEnabled: false });
  /* the shape's (x, y) is Unreal's (x, y), which the unit shape keeps as three's (x, z) */
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.5, 0);
  /* into the unit box: a half spans x -1..1 and y 0..1, a quarter both 0..1 */
  g.scale(half ? 0.5 : 1, 1, 1);
  g.translate(half ? 0 : -0.5, 0, -0.5);
  return g;
}
