// A Map's preview picture, from Steam's CDN. No state, so server and client components
// both draw it.
import { safeImg } from "../lib/rules";

/* the picture, or nothing when Steam gave none; `frame` sets it in the thumbnail frame a
   player's page and the head to head use, which stays when there is no picture */
export function MapImage({
  preview,
  className,
  frame,
}: {
  preview: string | null | undefined;
  className?: string;
  frame?: boolean;
}) {
  const src = safeImg(preview);
  const img = src ? (
    <img className={className} src={src} alt="" loading="lazy" decoding="async" />
  ) : null;
  return frame ? <span className="thumb">{img}</span> : img;
}
