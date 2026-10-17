// What a Map's 3D view shows until its Map is drawn: "Building the map…", or that the file
// couldn't be read. Map3D shows it while MapModel's chunk loads, and MapModel while the file
// arrives and the viewer builds; its own module, so MapModel imports nothing from the module
// that lazy-loads it.
export function MapWait({ failed = false }: { failed?: boolean }) {
  return (
    <div className="m3d-wait" aria-live="polite">
      {failed ? "Couldn't load the map." : "Building the map…"}
    </div>
  );
}
