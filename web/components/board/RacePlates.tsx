"use client";
// The full-size plates of a board whose runs race: a plate's score opens the race drawer,
// which opens under the podium.
import { Plates, type Plate } from "./Plates";
import { PodiumRace, useRaceOpen } from "./RaceDrawer";

export function RacePlates({
  name,
  top,
  focus,
}: {
  name: string;
  top: ReadonlyArray<Plate>;
  focus: string | null;
}) {
  const race = useRaceOpen(name, "podium");
  return (
    <>
      <Plates top={top} focus={focus} open={race.open} onRace={race.toggle} />
      <PodiumRace board={name} />
    </>
  );
}
