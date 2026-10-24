// How every page opens (spec #339, round 3's variant 1): the breadcrumb, the kind of page,
// then its title in the marquee, the page's one h1. The kind and the breadcrumb come from
// the navigation model (navOf, crumbsOf in lib/nav.ts); a page that names a `trail` has
// the board, list or player the reader came from as the breadcrumb's parent, and `back`
// gives a parent the server knows (a head to head's first player). Rendered by each page
// just under the header, so a client view's page renders it above the view.
import { Crumbs } from "./Crumbs";
import type { Trail, TrailPage } from "./Trail";
import { frameOf } from "./frame";
import { navOf, type Crumb } from "../lib/nav";

export async function PageHead({
  path,
  title,
  trail,
  page,
  back = null,
}: {
  path: string;
  title: string;
  trail?: Trail;
  /* the board the page is and who made it: whether a remembered player leads here */
  page?: TrailPage;
  back?: Crumb | null;
}) {
  /* the header's facts, read once for both */
  const { facts } = await frameOf();
  const kind = navOf(path, facts).kind;
  return (
    <div className="ph">
      <Crumbs path={path} title={title} facts={facts} trail={trail} page={page} back={back} />
      {kind && <p className="ph-kind">{kind}</p>}
      <h1 className="ph-title">{title}</h1>
    </div>
  );
}
