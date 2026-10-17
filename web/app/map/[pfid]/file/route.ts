// GET /map/<pfid>/file?v=<version>: a Workshop Map's file (its .ballmap), for its 3D view
// (components/workshop/Map3D). The bytes go out as the collector stored them, gzip-compressed,
// with Content-Encoding: gzip, so the browser unpacks them and nothing here does. The Map's
// page links the version it holds (lib/routes.ts mapFileHref): asked for under the stored
// version, the answer is the same bytes for good, so the browser and the CDN keep it a year;
// under any other (a page cached before the file changed) it is the current file for a
// minute. A Map whose file the site doesn't hold, or no Map at all, is a 404.
import { readMapFile } from "../../../../db/data";

const YEAR = "public, max-age=31536000, s-maxage=31536000, immutable";
const MINUTE = "public, max-age=60, s-maxage=60";

export async function GET(request: Request, { params }: { params: Promise<{ pfid: string }> }) {
  const f = await readMapFile((await params).pfid);
  if (!f) return Response.json({ error: "no such map file" }, { status: 404 });
  const asked = new URL(request.url).searchParams.get("v");
  return new Response(new Uint8Array(f.gzipped), {
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "cache-control": asked === f.version ? YEAR : MINUTE,
    },
  });
}
