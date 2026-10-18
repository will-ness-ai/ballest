// The two balls a marble can draw: a glass ball in a player's hue, and the game's own ball
// wearing a skin (lib/skins.ts). Server and client components both draw them (Marble.tsx,
// ChosenSkins.tsx, the Chosen Skin picker); each glass ball's gradient gets its own id.
import { useId } from "react";

import { hueFor } from "../lib/rules";
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
export function SkinBall({ src }: { src: string }) {
  return <img className="ball skin" src={src} alt="" loading="lazy" decoding="async" />;
}

/* a player's ball in `skin` (an object path): its picture, else their hue ball, which a Skin
   the site has no picture for, or none, draws too */
export function PlayerBall({ steamId, skin }: { steamId: string; skin: string | null }) {
  const src = skinPicture(skin);
  return src ? <SkinBall src={src} /> : <Ball h={hueFor(steamId)} />;
}
