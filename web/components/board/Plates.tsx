// The marble row: three plates, each a player, what they scored, and a line under it. A
// board draws them full size above its list; `small` draws them on a card, at one size on
// a phone and a desktop alike. No state, so server and client components both use it.
import { Marble, type MarbleWho } from "../Marble";
import { PlayerLink } from "../PlayerLink";
import { personaOf } from "../../lib/rules";

const PLACE = ["1st", "2nd", "3rd"];

export interface Plate {
  who: MarbleWho;
  score: React.ReactNode;
  line: string;
  /* the place it reads when equal values share one (1, 2, 2); its position otherwise */
  place?: number;
}

/* fewer than three draws nothing full size, where an empty step would read as a missing
   player; a small row draws what it has. The full-size row is the page's one `#leaders`; a
   small one can sit on a page several times, so it carries no id. */
export function Plates({
  top,
  focus = null,
  size = "full",
  tab,
}: {
  top: ReadonlyArray<Plate>;
  focus?: string | null;
  size?: "full" | "small";
  /* the player's page tab each name links to; their home tab without it */
  tab?: string;
}) {
  const id = size === "full" ? "leaders" : undefined;
  const cls = size === "full" ? "leaders" : "leaders small";
  if (top.length < (size === "full" ? 3 : 1)) return <div className={cls} id={id} hidden></div>;
  return (
    <div className={cls} id={id}>
      {top.slice(0, 3).map(({ who, score, line, place: shared }, i) => {
        const place = shared ?? i + 1;
        return (
          <div
            key={who.steamId}
            className={focus === who.steamId ? "plate focus" : "plate"}
            data-p={i + 1}
            data-place={place === i + 1 ? undefined : place}
            data-id={who.steamId}
          >
            <Marble who={who} />
            <span className="pl-text">
              <span className="pl-name">
                <PlayerLink id={who.steamId} text={personaOf(who)} tab={tab} />
              </span>
              <span className="pl-score">{score}</span>
              <span className="pl-gap">{line}</span>
            </span>
            <span className="pl-rank">{PLACE[place - 1]}</span>
          </div>
        );
      })}
    </div>
  );
}
