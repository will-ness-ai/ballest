// The upload ping (ADR 0009): what the admin hears in the dev server's #prefabs when a Prefab
// goes live, as one Discord message (pingOf) and the webhook post that sends it
// (discordPing). db/prefab-api.ts calls it after an upload; the tests read pingOf.
import { SITE_ORIGIN, prefabAdminHref, prefabHref } from "../lib/routes";

/* the picture's file name in the message */
const PICTURE = "prefab.png";

/* what the admin hears about an upload */
export interface PrefabPing {
  slug: string;
  name: string;
  pieces: number;
  tags: Array<string>;
  uploader: { steamId: string; name: string };
  picture: Uint8Array<ArrayBuffer> | null;
}

/* the Discord message for an upload: its picture, and link buttons to the page and to its
   Take down and Ban confirms there (a webhook can't take clicks itself; the page acts on
   the admin's own session) */
export function pingOf(p: PrefabPing) {
  const page = SITE_ORIGIN + prefabHref(p.slug);
  const link = (label: string, url: string) => ({ type: 2, style: 5, label, url });
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: p.name,
        url: page,
        description: [`by ${p.uploader.name}`, `${String(p.pieces)} pieces`, p.tags.join(", ")]
          .filter(Boolean)
          .join(" · "),
        ...(p.picture && { image: { url: `attachment://${PICTURE}` } }),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          link("Open", page),
          link("Take down", SITE_ORIGIN + prefabAdminHref(p.slug, "take-down")),
          link("Ban uploader", SITE_ORIGIN + prefabAdminHref(p.slug, "ban")),
        ],
      },
    ],
  };
}

/* posts an upload to the Prefabs channel's webhook (Vercel's OPS_WEBHOOK_URL, which the
   admin bot made, so it may carry buttons); skipped, with a log line, when it isn't set. A
   webhook Discord won't let carry buttons gets the message again without them */
export async function discordPing(p: PrefabPing): Promise<void> {
  const url = process.env.OPS_WEBHOOK_URL;
  if (!url) {
    console.log("prefab ping skipped: OPS_WEBHOOK_URL is not set");
    return;
  }
  const post = (withButtons: boolean) => {
    const { components, ...message } = pingOf(p);
    const body = new FormData();
    body.set("payload_json", JSON.stringify(withButtons ? { ...message, components } : message));
    if (p.picture) body.set("files[0]", new Blob([p.picture], { type: "image/png" }), PICTURE);
    const to = new URL(url);
    if (withButtons) to.searchParams.set("with_components", "true");
    return fetch(to, { method: "POST", body, signal: AbortSignal.timeout(5000) });
  };
  let r = await post(true);
  if (r.status === 400) r = await post(false);
  if (!r.ok) throw new Error(`Discord answered ${String(r.status)}: ${await r.text()}`);
}
