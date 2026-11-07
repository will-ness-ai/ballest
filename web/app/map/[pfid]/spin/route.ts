// GET /map/<pfid>/spin?v=<drawn at>: a Map's spinning 3D GIF (map_spins, drawn by daily-spin.yml),
// which Multiballs links on the Weekly Cup's Shortlist instead of uploading it: ten GIFs of 2-5 MB
// each are more than one Discord message takes. Asked for under the drawing it is (its drawn-at
// time in milliseconds), the answer is the same bytes for good, so Discord and the CDN keep it a
// year; under any other it is the current drawing for a minute. A Map never drawn is a 404.
import { readMapSpin } from "../../../../db/data";

const YEAR = "public, max-age=31536000, s-maxage=31536000, immutable";
const MINUTE = "public, max-age=60, s-maxage=60";

export async function GET(request: Request, { params }: { params: Promise<{ pfid: string }> }) {
  const s = await readMapSpin((await params).pfid);
  if (!s) return Response.json({ error: "no such spin" }, { status: 404 });
  const asked = new URL(request.url).searchParams.get("v");
  return new Response(new Uint8Array(s.gif), {
    headers: {
      "content-type": "image/gif",
      "cache-control": asked === String(s.drawnAt) ? YEAR : MINUTE,
    },
  });
}
