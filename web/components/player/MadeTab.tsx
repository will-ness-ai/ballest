"use client";
// A player's Made tab: every Map they published, the most run first, a dozen at a time
// until the reader asks for all of them.
import Link from "next/link";

import { usePlayerView } from "./usePlayerView";
import type { MadeMap } from "../../lib/player";
import { boardHref } from "../../lib/routes";
import { fmtN, fmtSec, fmtTime, personaOf, plural, safeImg } from "../../lib/rules";

const MADE_FIRST = 12;

function MadeCard({ m, id }: { m: MadeMap; id: string }) {
  const src = safeImg(m.preview);
  const inner = (
    <>
      <span className="im">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
      </span>
      <b>{m.display}</b>{" "}
      <span>
        {`${plural(m.runs, "run", "runs")} · ${plural(m.subs, "subscriber", "subscribers")}`}
      </span>{" "}
      <span className="f">
        {m.record
          ? `Record ${fmtTime(m.record.score)} by ${personaOf(m.record.who)}`
          : "No times yet"}
      </span>{" "}
      <span className="f">{`Author ${fmtSec(m.author)} · beaten by ${fmtN(m.beaten)}`}</span>
    </>
  );
  return m.record ? (
    <Link className="mkcard" href={boardHref(m.name, id)}>
      {inner}
    </Link>
  ) : (
    <div className="mkcard">{inner}</div>
  );
}

export function MadeTab({
  id,
  made,
  holds,
}: {
  id: string;
  made: ReadonlyArray<MadeMap>;
  holds: number;
}) {
  const [view, setView] = usePlayerView(id);
  const list = view.allMade ? made : made.slice(0, MADE_FIRST);
  const runs = made.reduce((s, m) => s + m.runs, 0),
    subs = made.reduce((s, m) => s + m.subs, 0);
  return (
    <div className="pws">
      <p className="wsline">
        {`${plural(made.length, "map", "maps")} · ${plural(runs, "run", "runs")} on them · ${plural(subs, "subscriber", "subscribers")} · still holds the record on ${fmtN(holds)}`}
      </p>{" "}
      <div className="mgrid mkgrid">
        {list.map((m) => (
          <MadeCard key={m.name} m={m} id={id} />
        ))}
      </div>{" "}
      {list.length < made.length ? (
        <button
          type="button"
          className="more-btn"
          data-madeall=""
          onClick={() => {
            setView({ ...view, allMade: true });
          }}
        >
          {`All ${fmtN(made.length)} maps`}
        </button>
      ) : null}
    </div>
  );
}
