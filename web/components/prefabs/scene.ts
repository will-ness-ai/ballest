// PROTOTYPE (grill-design, claude/prototype-prefabs): a Prefab as a three.js scene, shared
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
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30333d, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.6, 1, 0.4);
  scene.add(sun);
  const geometry = {
    box: new RoundedBoxGeometry(1, 1, 1, 1, 0.01),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 40),
    sphere: new THREE.SphereGeometry(0.5, 32, 20),
    scoop: scoopGeometry(THREE),
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
export async function stillOf(file: PrefabFile, w: number, h: number): Promise<string> {
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
  renderer.render(scene, camera);
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
