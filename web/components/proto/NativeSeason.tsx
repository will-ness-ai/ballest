"use client";
// PROTOTYPE (grill-design, Circuit tab, round 2): variant E's native select. Never merged.
import { useRouter } from "next/navigation";

export function NativeSeason({
  seasons,
  on,
}: {
  seasons: ReadonlyArray<{ group: string; href: string }>;
  on: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Season"
      value={on}
      onChange={(e) => {
        const s = seasons.find((x) => x.group === e.target.value);
        if (s) router.push(s.href);
      }}
    >
      {seasons.map((s) => (
        <option key={s.group} value={s.group}>
          {s.group}
        </option>
      ))}
    </select>
  );
}
