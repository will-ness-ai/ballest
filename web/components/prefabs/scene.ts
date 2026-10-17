// A Prefab as a three.js scene, shared
// by the live viewer and the list's still pictures.
import {
  PROFILE_SCALE,
  profileAxes,
  shapesOf,
  squeezeAt,
  squeezeAxis,
  type MeshProfile,
  type PrefabFile,
} from "../../lib/prefab";
import {
  DEFAULT_ANGLE,
  PAN_MAX,
  ZOOM_RANGE,
  checkAngle,
  type PrefabAngle,
} from "../../lib/prefabs";

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
    cone: new THREE.CylinderGeometry(0, 0.5, 1, 40),
    /* four sides, its corners at the middle of the bounds' edges, as SM_Pyramid's are */
    pyramid: new THREE.CylinderGeometry(0, 0.5, 1, 4),
    sphere: new THREE.SphereGeometry(0.5, 32, 20),
    halfRing: ringGeometry(THREE, "half"),
    quarterRing: ringGeometry(THREE, "quarter"),
    torus: torusGeometry(THREE),
  };
  /* one geometry per outline, however many pieces share it */
  const profiles = new Map<MeshProfile, import("three").BufferGeometry>();
  const prismOf = (p: MeshProfile) => {
    let g = profiles.get(p);
    if (!g) profiles.set(p, (g = profileGeometry(THREE, p)));
    return g;
  };
  const group = new THREE.Group();
  for (const s of shapesOf(file)) {
    const mesh = new THREE.Mesh(
      s.profile ? prismOf(s.profile) : geometry[s.kind],
      new THREE.MeshStandardMaterial({
        color: s.colour,
        roughness: 0.75,
        metalness: 0.05,
        side: THREE.DoubleSide,
        /* a lamp glows as the game draws it, washed toward white */
        ...(s.glow && {
          emissive: new THREE.Color(s.colour).lerp(new THREE.Color(0xffffff), 0.5),
          emissiveIntensity: 0.9,
        }),
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

/* where the camera sits and looks for `angle` (lib/prefabs.ts PrefabAngle): at zoom 1, just
   far enough back to fit the whole prefab */
export function framing(
  THREE: Three,
  camera: import("three").PerspectiveCamera,
  centre: import("three").Vector3,
  radius: number,
  angle: PrefabAngle | null = null,
) {
  angle ??= DEFAULT_ANGLE;
  const target = centre.clone().add(new THREE.Vector3(...angle.pan).multiplyScalar(radius));
  const dist = fitDistance(camera, radius) * angle.zoom;
  const position = target
    .clone()
    .add(new THREE.Vector3(...angle.from).normalize().multiplyScalar(dist));
  return { position, target };
}

/* the angle the camera now shows, framing's inverse */
export function angleNow(
  camera: import("three").PerspectiveCamera,
  target: import("three").Vector3,
  centre: import("three").Vector3,
  radius: number,
): PrefabAngle {
  const off = camera.position.clone().sub(target);
  /* clamped like zoom, so a view past the limits saves as the nearest one it can be */
  const pan = target.clone().sub(centre).divideScalar(radius).clampScalar(-PAN_MAX, PAN_MAX);
  const angle = checkAngle({
    from: off.toArray(),
    zoom: Math.min(
      ZOOM_RANGE[1],
      Math.max(ZOOM_RANGE[0], off.length() / fitDistance(camera, radius)),
    ),
    pan: pan.toArray(),
  });
  return angle ?? DEFAULT_ANGLE;
}

function fitDistance(camera: import("three").PerspectiveCamera, radius: number) {
  const v = (camera.fov * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * camera.aspect);
  return (radius / Math.sin(Math.min(v, h))) * 1.05;
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
  angle: PrefabAngle | null = null,
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
  const view = framing(three.THREE, camera, centre, radius, angle);
  camera.position.copy(view.position);
  camera.lookAt(view.target);
  renderer.setSize(w, h, false);
  if (background) renderer.setClearColor(background, 1);
  renderer.render(scene, camera);
  if (background) renderer.setClearColor(0x000000, 0);
  return renderer.domElement.toDataURL("image/png");
}

/* a piece's outline in one view pushed straight through its bounds, in the unit box: the
   outline's across, up and through directions laid along three's axes (lib/prefab.ts) */
function profileGeometry(THREE: Three, profile: MeshProfile) {
  /* a squeezed prism bends along its outline, so it needs corners all along it (the squeeze is
     even through the depth, so the depth needs none) */
  const step = profile.squeeze ? 1 / SQUEEZE_STEPS : Infinity;
  const shapes = profile.shapes.map(([outer, ...holes]) => {
    const shape = new THREE.Shape(points(THREE, outer, step));
    shape.holes = holes.map((h) => new THREE.Path(points(THREE, h, step)));
    return shape;
  });
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: 1,
    bevelEnabled: false,
  });
  const [across, up, through] = profileAxes(profile.view);
  const axis = (i: number, sign = 1) => new THREE.Vector3().setComponent(i, sign);
  /* an odd swap of axes would turn the faces inside out; pushing the other way undoes it,
     and the prism is the same either way */
  const odd =
    new THREE.Matrix4().makeBasis(axis(across), axis(up), axis(through)).determinant() < 0;
  const place = new THREE.Matrix4().makeBasis(axis(across), axis(up), axis(through, odd ? -1 : 1));
  g.translate(-0.5, -0.5, -0.5);
  g.applyMatrix4(place);
  const shared = squeezeAxis(profile);
  if (profile.squeeze && shared !== null) {
    /* a second view's outline narrows how far each part of the prism reaches */
    const position = g.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const [lo, hi] = squeezeAt(profile.squeeze.spans, position.getComponent(i, shared) + 0.5);
      const depth = position.getComponent(i, through) + 0.5;
      position.setComponent(i, through, lo + depth * (hi - lo) - 0.5);
    }
    g.computeVertexNormals();
  }
  return g;
}

const SQUEEZE_STEPS = 24;

/* an outline's flat x, y list (thousandths) as points in the unit square, no two more than
   `step` apart */
function points(THREE: Three, flat: Array<number>, step: number) {
  const out = [];
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const a = new THREE.Vector2(flat[2 * i], flat[2 * i + 1]).divideScalar(PROFILE_SCALE);
    const j = (i + 1) % n;
    const b = new THREE.Vector2(flat[2 * j], flat[2 * j + 1]).divideScalar(PROFILE_SCALE);
    const parts = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 0; k < parts; k++) out.push(a.clone().lerp(b, k / parts));
  }
  return out;
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

/* MP_RoundedTorus's stand-in: a ring lying flat (Unreal's x-y plane) whose tube is the bounds'
   height, 300 of 2300 cm across */
function torusGeometry(THREE: Three) {
  const g = new THREE.TorusGeometry(1000, 150, 16, 64);
  g.rotateX(Math.PI / 2);
  g.scale(1 / 2300, 1 / 300, 1 / 2300);
  return g;
}
