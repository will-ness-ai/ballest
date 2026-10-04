"use client";
// How long ago a Map was published, kept current in a cached page: counted to when the
// data was read until the browser's clock takes over (useClock in lib/client.ts).
import { useClock } from "../../lib/client";
import { ageText } from "../../lib/rules";

export function Age({ created, asOf }: { created: number; asOf: number }) {
  return <>{ageText(created, useClock(asOf))}</>;
}
