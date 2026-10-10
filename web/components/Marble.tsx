// A player's marble: the ball skin their run was rolled with where its Ghost has been read
// (lib/skins.ts), else a glass ball in a hue taken from their Steam ID. It turns over to
// their Steam avatar where Steam gave one (on hover, focus, or a tap: Behaviours.tsx).
// Server and client components both draw them; each ball's gradient gets its own id.
import { useId } from "react";

import { hueFor, personaOf, safeImg } from "../lib/rules";
import { skinPicture } from "../lib/skins";

export function Ball({ h }: { h: number }) {
  const id = useId();
  return (
    <svg className="ball" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <radialGradient id={"g" + id} cx="34%" cy="27%" r="80%">
          <stop offset="0%" stopColor={`hsl(${h} 94% 90%)`} />
          <stop offset="34%" stopColor={`hsl(${h} 80% 64%)`} />
          <stop offset="100%" stopColor={`hsl(${h} 62% 25%)`} />
        </radialGradient>
        <clipPath id={"c" + id}>
          <circle cx="20" cy="20" r="19" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="19" fill={`url(#g${id})`} />
      <g clipPath={`url(#c${id})`}>
        <path
          d="M-4 27C6 34 18 33 26 26s10-16 8-24"
          fill="none"
          stroke={`hsl(${h} 66% 20%)`}
          strokeOpacity=".26"
          strokeWidth="4.5"
        />
        <path
          d="M2 8c8 2 16 8 19 17"
          fill="none"
          stroke={`hsl(${h} 96% 92%)`}
          strokeOpacity=".2"
          strokeWidth="3"
        />
      </g>
      <ellipse
        cx="13"
        cy="11.5"
        rx="5.4"
        ry="3.4"
        fill="#fff"
        fillOpacity=".62"
        transform="rotate(-28 13 11.5)"
      />
      <circle cx="20" cy="20" r="19" fill="none" stroke={`hsl(${h} 60% 16%)`} strokeOpacity=".35" />
    </svg>
  );
}

/* the ball as the game draws it: a picture of the skin, already round */
function Skin({ src }: { src: string }) {
  return <img className="ball skin" src={src} alt="" loading="lazy" decoding="async" />;
}

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
  const skin = skinPicture(who.skin);
  const ball = skin ? <Skin src={skin} /> : <Ball h={h} />;
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
