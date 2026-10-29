"use client";
/* eslint-disable -- PROTOTYPE, never merged */
// PROTOTYPE: shows its children only on the variants `k` names ("AC" = A and C).
import { useVariant } from "./Proto";

export function V({ k, children }: { k: string; children: React.ReactNode }) {
  const v = useVariant();
  if (!v || !k.includes(v)) return null;
  return <>{children}</>;
}
