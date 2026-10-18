// A player's marble: the ball skin their run was rolled with where its Ghost has been read
// (lib/skins.ts), else the Chosen Skin they picked (ChosenBall, components/ChosenSkins.tsx, the
// one part that reads the page's picks on the client), else a glass ball in a hue taken from
// their Steam ID. It turns over to their Steam avatar where Steam gave one (on hover, focus,
// or a tap: Behaviours.tsx). Server and client components both draw them.
import { Ball, SkinBall } from "./Ball";
import { ChosenBall } from "./ChosenSkins";
import { hueFor, personaOf, safeImg } from "../lib/rules";
import { skinPicture } from "../lib/skins";

export interface MarbleWho {
  steamId: string;
  /* the skin the run's Ghost names, where there is one */
  skin?: string | null;
  persona?: string | null;
  avatar?: string | null;
}

/* the marble is the control that reveals the avatar, so where there is an avatar to reveal
   it is a real button; where Steam gave none it stays inert. `still` keeps it inert
   anyway, for a marble inside a link, where a button can't go */
export function Marble({ who, still = false }: { who: MarbleWho; still?: boolean }) {
  const h = hueFor(who.steamId);
  const run = skinPicture(who.skin);
  const ball = run ? <SkinBall src={run} /> : <ChosenBall steamId={who.steamId} />;
  const style = { "--h": h } as React.CSSProperties;
  const avatar = safeImg(who.avatar);
  if (!avatar || still)
    return (
      <span className="marble" style={style}>
        {ball}
      </span>
    );
  return (
    <button
      type="button"
      className="marble"
      style={style}
      aria-label={`Show ${personaOf(who)}'s Steam avatar`}
    >
      {ball}
      <img className="face" src={avatar} alt="" loading="lazy" decoding="async" />
    </button>
  );
}

const RACK = [212, 332, 96];

/* the brand's three marbles */
export function Rack() {
  return (
    <span className="rack" id="rack" aria-hidden="true">
      {RACK.map((h) => (
        <span className="marble" key={h}>
          <Ball h={h} />
        </span>
      ))}
    </span>
  );
}

/* the same three, drifting behind the page */
export function Ambient() {
  return (
    <div className="ambient" id="ambient" aria-hidden="true">
      {RACK.map((h) => (
        <span key={h}>
          <span className="marble">
            <Ball h={h} />
          </span>
        </span>
      ))}
    </div>
  );
}
