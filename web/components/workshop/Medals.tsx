// A Map's Medal times as a list, best first, each with its colour's dot: the Map page's panel
// and its 3D view's corner card both draw it, the card with the record on top. Each place's
// look is its own class (maps.css .mp-medals, desktop.css .m3d-card).
import { MEDALS, fmtSec, fmtTime } from "../../lib/rules";

export function MedalList({
  medals,
  record,
  className,
}: {
  /* [bronze, silver, gold, author], seconds */
  medals: ReadonlyArray<number>;
  /* with it, a Record row first: the record in ticks */
  record?: number;
  className: string;
}) {
  return (
    <dl className={className}>
      {record !== undefined && (
        <div>
          <dt>Record</dt>
          <dd>{fmtTime(record)}</dd>
        </div>
      )}
      {MEDALS.map(([name, c, i]) => (
        <div key={name}>
          <dt>
            <i style={{ background: c }}></i>
            {name}
          </dt>
          <dd>{fmtSec(medals[i])}</dd>
        </div>
      ))}
    </dl>
  );
}
