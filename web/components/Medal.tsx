// A Medal, drawn: a disc on a ribbon, or a plain disc when `mini`. A player's Workshop tab
// draws one per finish and on its trophy shelf, and a Daily's board one per time. No state,
// so server and client components both draw it.
import { MEDAL_LABEL, type MedalKey } from "../lib/rules";

export function Medal({ t, size, mini }: { t: MedalKey; size: number; mini?: boolean }) {
  return (
    <span
      className={mini ? "medal mini" : "medal"}
      data-t={t}
      style={{ "--s": String(size) + "px" } as React.CSSProperties}
      title={MEDAL_LABEL[t]}
    >
      {t === "wr" ? "1" : ""}
    </span>
  );
}
