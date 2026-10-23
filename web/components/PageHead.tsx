// How every page opens (spec #339, round 3's variant 1): the breadcrumb, the kind of page,
// then its title in the marquee, the page's one h1. The kind and the breadcrumb come from
// the navigation model (navOf, crumbsOf in lib/nav.ts); a page that names a `trail` has
// the board, list or player the reader came from as the breadcrumb's parent, and `back`
// gives a parent the server knows (a head to head's first player). Rendered by each page
// just under the header, so a client view's page renders it above the view.
import { Crumbs } from "./Crumbs";
import { navFacts } from "./Shell";
import type { Trail } from "./Trail";
import { crumbsOf, navOf, type Crumb } from "../lib/nav";

export async function PageHead({
  path,
  title,
  trail,
  back = null,
}: {
  path: string;
  title: string;
  trail?: Trail;
  back?: Crumb | null;
}) {
  const facts = await navFacts();
  const kind = navOf(path, facts).kind;
  return (
    <div className="ph">
      <Crumbs
        path={path}
        title={title}
        crumbs={crumbsOf(path, facts, title, back)}
        trail={trail && { name: trail, facts }}
      />
      {kind && <p className="ph-kind">{kind}</p>}
      <h1 className="ph-title">{title}</h1>
    </div>
  );
}
