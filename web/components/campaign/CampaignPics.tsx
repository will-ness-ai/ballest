// A Campaign's picture: its first Maps' previews side by side, a hairline between. The
// homepage's banners, /campaigns and a player's Campaign cards all draw it. No state, so
// server and client components both can.
import { MapImage } from "../MapImage";

export function CampaignPics({
  previews,
  max = 5,
  className,
}: {
  /* the Maps' preview pictures, in the Campaign's order; a Map with none is a blank panel */
  previews: ReadonlyArray<string | null>;
  max?: number;
  className?: string;
}) {
  return (
    <span className={"cpics" + (className ? " " + className : "")} aria-hidden="true">
      {previews.slice(0, max).map((p, i) => (
        <span key={i}>
          <MapImage preview={p} />
        </span>
      ))}
    </span>
  );
}
