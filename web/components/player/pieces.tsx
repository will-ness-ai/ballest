// The small pieces a player's page, the head to head and the score card share: a Map's
// thumbnail, a Medal, the score between two players, and Steam's mark. None holds state,
// so server and client components both use them.
import { TIER_LABEL, fmtN, safeImg, type Tier } from "../../lib/rules";

/* a Map's preview picture in its frame; the frame stays when Steam gave none */
export function Thumb({ preview }: { preview?: string | null }) {
  const src = safeImg(preview);
  return (
    <span className="thumb">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
    </span>
  );
}

export function Medal({ t, size, mini }: { t: Tier; size: number; mini?: boolean }) {
  return (
    <span
      className={mini ? "medal mini" : "medal"}
      data-t={t}
      style={{ "--s": String(size) + "px" } as React.CSSProperties}
      title={TIER_LABEL[t]}
    >
      {t === "wr" ? "1" : ""}
    </span>
  );
}

/* A's wins, a dash, B's wins */
export function Score({ t }: { t: { a: number; b: number } }) {
  return (
    <span className="score">
      <span className="ca">{fmtN(t.a)}</span>
      <span className="d">&ndash;</span>
      <span className="cb">{fmtN(t.b)}</span>
    </span>
  );
}

/* Steam's own mark, so the one link that leaves this site looks like it does */
export function SteamMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-9.96 9.1l5.36 2.22a2.83 2.83 0 0 1 1.6-.5l2.38-3.46v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.4 2.43v.1a2.83 2.83 0 0 1-5.6.56L2.23 14.6A10 10 0 1 0 12 2Zm-5.7 15.2a2.12 2.12 0 0 0 3.9-1.5l-1.72-.7a1.53 1.53 0 1 1 1.14-2.83l1.7.7a2.12 2.12 0 0 0-3.9 1.5l-1.12-.47Zm8.85-7.9a2.51 2.51 0 1 0 .01.01Zm-1.88 0a1.89 1.89 0 1 1 3.77 0 1.89 1.89 0 0 1-3.77 0Z" />
    </svg>
  );
}

/* what a player's page and a head to head show while they are read */
export function PageFallback({ id, className }: { id: string; className: string }) {
  return (
    <div className="main">
      <section className="content">
        <div className={className} id={id}>
          <div className="pseason">
            {Array.from({ length: 3 }, (_, i) => (
              <div className="skel" key={i}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
