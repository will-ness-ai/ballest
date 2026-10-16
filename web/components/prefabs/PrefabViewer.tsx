"use client";
// PROTOTYPE (grill-design, claude/prototype-prefabs): a Prefab drawn in three.js. It turns
// slowly on its own until someone grabs it (not under reduced motion); drag to turn, wheel
// or pinch to zoom, right-drag to pan. three loads only where a viewer is.
import { useEffect, useRef } from "react";

import { buildScene, framing, loadThree } from "./scene";
import type { PrefabFile } from "../../lib/prefab";

export function PrefabViewer({
  file,
  className,
  spin = true,
  controls: interactive = true,
}: {
  file: PrefabFile;
  className?: string;
  spin?: boolean;
  controls?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop = () => {};
    let cancelled = false;
    void (async () => {
      const three = await loadThree();
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (cancelled) return;
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
      const home = () => {
        camera.position.copy(framing(THREE, camera, centre, radius));
        controls.target.copy(centre);
        controls.update();
      };
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
      el.dataset.ready = "1";
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
  }, [file, spin, interactive]);

  return <div ref={host} className={className ?? "pfv"} />;
}
