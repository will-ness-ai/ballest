"use client";
// PROTOTYPE (grill-design, claude/prototype-prefabs): a Prefab drawn in three.js, orbit to
// turn it, wheel or pinch to zoom, right-drag to pan. three loads only on this page.
import { useEffect, useRef } from "react";

import { shapesOf, type PrefabFile } from "../../lib/prefab";

export function PrefabViewer({
  file,
  className,
  autoRotate = false,
  grid = true,
}: {
  file: PrefabFile;
  className?: string;
  autoRotate?: boolean;
  grid?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop = () => {};
    let cancelled = false;
    void (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { RoundedBoxGeometry } =
        await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      if (cancelled) return;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);

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

      /* frame it: centre on its box, back off to fit, look a little down */
      const box = new THREE.Box3().setFromObject(group);
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
      if (grid) {
        const size = Math.max(2, Math.ceil(radius * 1.6));
        const g = new THREE.GridHelper(size, size, 0x5a6280, 0x2c3248);
        g.position.set(centre.x, box.min.y - 0.001, centre.z);
        scene.add(g);
      }
      const home = () => {
        const v = (camera.fov * Math.PI) / 360;
        const h = Math.atan(Math.tan(v) * camera.aspect);
        const dist = (radius / Math.sin(Math.min(v, h))) * 1.05;
        camera.position
          .copy(centre)
          .add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(dist));
        controls.target.copy(centre);
        controls.update();
      };
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 1.2;
      el.dataset.ready = "1";
      el.addEventListener("prefab:home", home);

      const resize = () => {
        const { width, height } = el.getBoundingClientRect();
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();
      home();
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
      stop = () => {
        ro.disconnect();
        renderer.setAnimationLoop(null);
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [file, autoRotate, grid]);

  return <div ref={host} className={className ?? "pfv"} />;
}

/* SM_2000_45scoop stand-in: a slab whose top curves up from flat to 45 degrees along x */
function scoopGeometry(THREE: typeof import("three")) {
  const shape = new THREE.Shape();
  const n = 16;
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const x = -0.5 + t;
    shape.lineTo(x, -0.5 + 0.12 + 0.88 * t * t);
  }
  shape.lineTo(-0.5, -0.5);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}
