"use client";
// A Prefab drawn in three.js, starting from its angle. It turns
// slowly on its own until someone grabs it (not under reduced motion); drag to turn, wheel
// or pinch to zoom, right-drag to pan. three loads only where a viewer is. A "prefab:home"
// event on it goes back to the angle, and `onGrab` is handed a read of the angle it shows now.
import { useCallback, useEffect, useRef } from "react";

import { angleNow, buildScene, framing, loadThree } from "./scene";
import type { PrefabFile } from "../../lib/prefab";
import type { PrefabAngle } from "../../lib/prefabs";

export function PrefabViewer({
  file,
  className,
  spin = true,
  controls: interactive = true,
  angle = null,
  onGrab,
}: {
  file: PrefabFile;
  className?: string;
  spin?: boolean;
  controls?: boolean;
  angle?: PrefabAngle | null;
  onGrab?: (read: (() => PrefabAngle) | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  /* read at each "home", so a new angle moves the camera there without rebuilding the
     scene; compared by value, so the same view arriving again doesn't */
  const home = useRef(angle);
  const view = JSON.stringify(angle);
  useEffect(() => {
    home.current = angle;
    host.current?.dispatchEvent(new Event("prefab:home"));
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps -- by value

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop: (() => void) | undefined;
    const run = { cancelled: false };
    void (async () => {
      const three = await loadThree();
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (run.cancelled) return;
      const { THREE } = three;
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      const { scene, centre, radius } = buildScene(three, file, interactive);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enabled = interactive;
      controls.enableDamping = true;
      controls.autoRotate = spin && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      controls.autoRotateSpeed = 1.6;
      /* the spin only says "this is 3D": the first grab stops it for good */
      controls.addEventListener("start", () => (controls.autoRotate = false));
      const goHome = () => {
        const view = framing(THREE, camera, centre, radius, home.current);
        camera.position.copy(view.position);
        controls.target.copy(view.target);
        controls.update();
      };
      el.addEventListener("prefab:home", goHome);
      onGrab?.(() => angleNow(camera, controls.target, centre, radius));
      const resize = () => {
        const { width, height } = el.getBoundingClientRect();
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();
      goHome();
      el.dataset.ready = "1";
      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
      stop = () => {
        onGrab?.(null);
        el.removeEventListener("prefab:home", goHome);
        ro.disconnect();
        renderer.setAnimationLoop(null);
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      run.cancelled = true;
      stop?.();
    };
  }, [file, spin, interactive, onGrab]);

  return <div ref={host} className={className ?? "pfv"} />;
}

/* what a parent passes as a viewer's onGrab, and a read of the angle it shows now (null
   until it has drawn) */
export function useAngleReader() {
  const read = useRef<(() => PrefabAngle) | null>(null);
  const onGrab = useCallback((r: (() => PrefabAngle) | null) => {
    read.current = r;
  }, []);
  return { onGrab, angleNow: () => read.current?.() ?? null };
}
