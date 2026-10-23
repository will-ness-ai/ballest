// A Prefab's page (docs/site.md "Prefabs"): the viewer on the left; its name, uploader,
// description, size, pieces, tags and Download beside it. Settled in grill-design round 1:
// B · Sidebar, with A's piece chips, D's ? how-to and a slow spin until the model is grabbed.
import Link from "next/link";

import { PlayerLink } from "../PlayerLink";
import { Favorite } from "./Favorite";
import { PrefabModel } from "./PrefabModel";
import { PrefabTools } from "./PrefabTools";
import type { PrefabPage as Prefab } from "../../db/data";
import { dayLabel } from "../../lib/daily";
import { pieceLabel } from "../../lib/prefab";
import { stemOf } from "../../lib/prefab-check";
import { prefabFileHref, prefabsHref } from "../../lib/routes";

export const metres = (m: number) => (m < 10 ? m.toFixed(1) : Math.round(m).toString()) + " m";
export const kb = (b: number) => String(Math.max(1, Math.round(b / 1024))) + " KB";

export function PrefabPage({ p }: { p: Prefab }) {
  return (
    <div className="pf">
      <div className="pf-split">
        <PrefabModel src={prefabFileHref(p.slug)} name={stemOf(p.fileName)} angle={p.angle} />
        <aside className="pf-side">
          <h1>{p.name}</h1>
          <p className="pf-by">
            by{" "}
            {p.uploader.isPlayer ? (
              <PlayerLink id={p.uploader.steamId} text={p.uploader.name} />
            ) : (
              p.uploader.name
            )}{" "}
            · added {dayLabel(p.createdAt.slice(0, 10), true)}
          </p>
          {p.description && <p className="pf-desc">{p.description}</p>}
          <dl className="pf-stats">
            <div>
              <dt>Pieces</dt>
              <dd>{p.pieces}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {metres(p.size.w)} × {metres(p.size.d)} × {metres(p.size.h)}
              </dd>
            </div>
            <div>
              <dt>File</dt>
              <dd>{kb(p.bytes)}</dd>
            </div>
          </dl>
          <ul className="pf-parts" aria-label="Pieces">
            {p.parts.map((part) => (
              <li key={part.piece}>
                <span>{pieceLabel(part.piece)}</span>
                <b>×{part.count}</b>
              </li>
            ))}
          </ul>
          {p.tags.length > 0 && (
            <ul className="pf-tags" aria-label="Tags">
              {p.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <div className="pf-actions">
            <a className="pf-dl big" href={prefabFileHref(p.slug)} download={p.fileName}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" />
              </svg>
              Download <span className="pf-fn">{p.fileName}</span>
            </a>
            <Favorite slug={p.slug} favorites={p.favorites} />
          </div>
          <PrefabTools p={p} />
        </aside>
      </div>
    </div>
  );
}

/* a link to a Prefab nobody uploaded, or one that is deleted, taken down or hidden */
export function PrefabGone({ p }: { p: Prefab | null }) {
  return (
    <div className="pf pf-gone">
      <h1>This prefab is gone</h1>
      <p>
        It was deleted or taken down, or the link is wrong.{" "}
        <Link href={prefabsHref()}>See every prefab</Link>.
      </p>
      {p && <PrefabTools p={p} />}
    </div>
  );
}
