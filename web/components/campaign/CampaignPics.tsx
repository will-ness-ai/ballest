// PROTOTYPE (grill-design): a Campaign's picture, its first Maps' previews side by side.
// Never merged. The homepage banner and a player's Campaign card both draw it.
import { safeImg } from "../../lib/rules";

export function CampaignPics({
  previews,
  max = 5,
}: {
  previews: ReadonlyArray<string | null>;
  max?: number;
}) {
  const pics = previews.slice(0, max);
  return (
    <span className="cpics" aria-hidden="true">
      {pics.map((p, i) => {
        const src = safeImg(p);
        return <span key={i}>{src ? <img src={src} alt="" decoding="async" /> : null}</span>;
      })}
    </span>
  );
}
