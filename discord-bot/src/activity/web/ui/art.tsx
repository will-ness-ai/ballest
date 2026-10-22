// The small pictures every screen uses: marbles, Medals, the logo, Map art, and the countdowns.
// The marble and Medal art is the bot's own (render/art.ts), drawn as SVG strings from numbers
// only, so it goes in as markup; every text from Discord or Steam is React text.
import { useId, useState, useSyncExternalStore } from "react";
import type { MedalKind } from "../../../domain.js";
import type { ChosenSkin } from "../../../ports.js";
import { hueFor, marbleSvg, medalSvg } from "../../../render/art.js";
import { skinPictureFile } from "../../../render/skinList.js";
import type { MatchView } from "../../api.js";
import { clockText, serverClock } from "../clock.js";

/** The id React gives this spot, made safe for an SVG `url(#...)`. */
const useSvgId = () => useId().replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * A Player's marble: their Chosen Skin's picture (already round), else the site's marble,
 * coloured by SteamID so a Player has one colour everywhere; grey for an empty seat. A Skin the
 * list doesn't know draws the marble.
 */
export const Marble = ({
  steamId,
  size = 24,
  skin = null,
  hue,
}: {
  readonly steamId: string | null;
  readonly size?: number;
  readonly skin?: ChosenSkin;
  readonly hue?: number;
}) => {
  const id = useSvgId();
  const file = skin === null ? null : skinPictureFile(skin);
  const style = { width: size, height: size };
  if (file !== null)
    return (
      <span className="marble" style={style}>
        <img src={`/skins/${file}`} alt="" width={size} height={size} />
      </span>
    );
  const art = marbleSvg(hue ?? (steamId === null ? 220 : hueFor(steamId)), size, id);
  return <span className="marble" style={style} dangerouslySetInnerHTML={{ __html: art }} />;
};

/** A Player's marble in a Match, in the Chosen Skin its view carries for them. */
export const MarbleIn = ({
  m,
  steamId,
  size,
}: {
  readonly m: MatchView;
  readonly steamId: string | null;
  readonly size?: number;
}) => (
  <Marble
    steamId={steamId}
    {...(size === undefined ? {} : { size })}
    skin={steamId === null ? null : (m.skins[steamId] ?? null)}
  />
);

export const Medal = ({
  kind,
  w = 16,
}: {
  readonly kind: MedalKind | null;
  readonly w?: number;
}) => {
  const id = useSvgId();
  if (kind === null) return null;
  return (
    <span
      role="img"
      aria-label={`${kind} Medal`}
      style={{ display: "inline-flex", flex: "none" }}
      dangerouslySetInnerHTML={{ __html: medalSvg(kind, w, id) }}
    />
  );
};

export const Logo = () => (
  <span className="logo">
    <span className="rack">
      <Marble steamId={null} size={18} hue={212} />
      <Marble steamId={null} size={18} hue={332} />
      <Marble steamId={null} size={18} hue={96} />
    </span>
    <span className="wordmark">
      Multi<b>balls</b>
    </span>
  </span>
);

/** Matches whose preview didn't load: they keep the stand-in art rather than asking again. */
const noPreview = new Set<string>();

/** The Map's Workshop preview over the stand-in art, or the sealed "?" before the draw. */
export const MapArt = ({ m }: { readonly m: MatchView }) => {
  const [failed, setFailed] = useState(() => noPreview.has(m.matchId));
  if (m.map === null) return <div className="sealed">?</div>;
  return (
    <div className="art">
      {failed ? null : (
        <img
          src={`/previews/${m.matchId}`}
          alt=""
          onError={() => {
            noPreview.add(m.matchId);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
};

/** Time left until `at` on the server's clock, ticking by itself. */
export const Countdown = ({ at }: { readonly at: number | null }) => {
  const now = useSyncExternalStore(serverClock.subscribe, serverClock.now);
  return <span>{clockText(Math.max(0, Math.ceil(((at ?? 0) - now) / 1000)))}</span>;
};
