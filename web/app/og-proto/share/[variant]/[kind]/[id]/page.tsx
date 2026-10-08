// PROTOTYPE (grill-design, share images): a page to paste into Discord, whose link
// preview is one variant's card. Never merged.
import type { Metadata } from "next";
import { Suspense } from "react";

import { KINDS, VARIANTS, cardFor, type Kind } from "../../../../cards";

interface Props {
  params: Promise<{ variant: string; kind: string; id: string }>;
}

export function generateStaticParams() {
  return [{ variant: "A", kind: "player", id: "76561198071746847" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { variant, kind, id } = await params;
  if (!(variant in VARIANTS) || !KINDS.includes(kind as Kind)) return {};
  const d = await cardFor(kind as Kind, id);
  if (!d) return {};
  /* metadataBase is the production address, which has no prototype: point at this deploy */
  const host = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
  const img = (host ? "https://" + host : "") + `/og-proto/img/${variant}/${kind}/${id}`;
  return {
    title: d.title,
    description: `Prototype share card, variant ${variant}.`,
    openGraph: { title: d.title, images: [{ url: img, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [img] },
  };
}

async function Body({ params }: Props) {
  const { variant, kind, id } = await params;
  return (
    <p style={{ padding: 24, color: "#eaf0ff" }}>
      Prototype share link: variant {variant}, {kind} {id}.{" "}
      <a style={{ color: "#8be03c" }} href={`/og-proto?variant=${variant}`}>Back to the picker</a>
    </p>
  );
}

export default function Page({ params }: Props) {
  return (
    <Suspense>
      <Body params={params} />
    </Suspense>
  );
}
