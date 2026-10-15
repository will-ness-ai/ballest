// PROTOTYPE (grill-design): /campaign/<slug>. Never merged.
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Shell } from "../../../components/Shell";
import { Picker } from "../../../components/campaign/Picker";
import { CampaignVariants, VARIANTS } from "../../../components/campaign/Variants";
import { getCampaign } from "../../../db/campaign";
import { CAMPAIGNS, campaignHref, campaignOf } from "../../../lib/campaigns";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return CAMPAIGNS.map((c) => ({ slug: c.slug }));
}

async function Body({ params }: Props) {
  const { slug } = await params;
  const c = campaignOf(slug);
  if (!c) notFound();
  const { maps, rows } = await getCampaign(c);
  return (
    <>
      <CampaignVariants c={c} maps={maps} rows={rows} />
      <Picker
        variants={VARIANTS.map(({ key, name, note }) => ({ key, name, note }))}
        states={CAMPAIGNS.map((x) => [x.title, campaignHref(x.slug)])}
      />
    </>
  );
}

export default function Page({ params }: Props) {
  return (
    <Shell view="workshop">
      <Suspense fallback={null}>
        <Body params={params} />
      </Suspense>
    </Shell>
  );
}
