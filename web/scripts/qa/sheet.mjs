// `qa sheet`'s pictures: a grill-design round's variants drawn so Will can judge them in the
// thread without opening the preview. Each variant gets a card (its name and note over its
// desktop and phone shots, side by side, at a size that reads on a phone), and the round gets
// an overview (a row per variant, small) to compare them at a glance. Both are drawn as HTML
// in the browser qa already has and saved as JPEG.

export const SHEET_WIDTH = 1400;
// the tallest stretch of a shot a picture shows; the rest is cut, and the cut says how much
const CARD_MAX = 1100;
const ROW_MAX = 520;

/**
 * The round's variants: --variants (keys, comma-separated) when given, else the picker's own
 * list, which ProtoPicker publishes as `data-variants`, a JSON array of [key, name, note?].
 * Null when neither names any, so the command can say how to name them.
 * @param {string | null} published
 * @param {string | undefined} flag
 */
export function variantsOf(published, flag) {
  let listed;
  try {
    listed = published ? JSON.parse(published) : [];
  } catch {
    listed = [];
  }
  const all = Array.isArray(listed)
    ? listed
        .filter((e) => Array.isArray(e) && e.length > 0)
        .map(([key, name = "", note = ""]) => ({
          key: String(key),
          name: String(name),
          note: String(note),
        }))
    : [];
  if (flag) {
    return flag
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => all.find((v) => v.key === key) ?? { key, name: "", note: "" });
  }
  return all.length ? all : null;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const uri = (png) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
const label = (v) => `${esc(v.key)}${v.name ? " · " + esc(v.name) : ""}`;

const STYLE = `
*{box-sizing:border-box}
body{margin:0;width:${String(SHEET_WIDTH)}px;background:#0d1020;color:#eef0fa;font:18px/1.35 system-ui,sans-serif}
.head{display:flex;gap:16px;align-items:baseline;padding:18px 24px 12px}
.head b{font-size:34px}
.head span{color:#a9b0cf;font-size:20px}
.pick{margin-left:auto;padding:4px 12px;border-radius:99px;background:#9be15d;color:#132;font-weight:700;font-size:18px}
.shots{display:flex;gap:20px;align-items:flex-start;padding:0 24px 24px}
figure{margin:0;display:grid;gap:6px}
figcaption{color:#7d85a8;font-size:15px}
.frame{position:relative;overflow:hidden;border:1px solid #2c3355;border-radius:10px}
.frame img{display:block;width:100%}
.cut{position:absolute;inset:auto 0 0;padding:28px 10px 8px;background:linear-gradient(transparent,#0d1020 70%);color:#a9b0cf;font-size:14px;text-align:center}
.row{display:grid;grid-template-columns:200px 1fr 260px;gap:16px;align-items:start;padding:14px 24px;border-top:1px solid #2c3355}
.row b{font-size:24px;display:block}
.row span{color:#a9b0cf;font-size:15px}
.row.on{background:#17202e}
`;

/* a shot in a frame `width` wide, cut at `max` px of the frame's height (or where the shot's
   own `upTo` px falls, when that is lower down), the cut said */
function framed(png, shotWidth, width, max, upTo) {
  const scale = width / shotWidth;
  const cut = upTo ? Math.max(max, Math.ceil((upTo + 24) * scale)) : max;
  return `<div class="frame" style="width:${String(width)}px;max-height:${String(cut)}px"><img src="${uri(png)}" data-w="${String(shotWidth)}" data-scale="${String(scale)}"><div class="cut" hidden></div></div>`;
}

/* marks each frame whose picture runs past it with how much is cut, in the shot's own px */
function markCuts() {
  for (const f of document.querySelectorAll(".frame")) {
    const img = f.querySelector("img");
    const over = img.offsetHeight - f.clientHeight;
    if (over <= 4) continue;
    const c = f.querySelector(".cut");
    c.hidden = false;
    c.textContent = `… ${String(Math.round(over / Number(img.dataset.scale)))} px more below`;
  }
}

/**
 * One variant's card: its name and note, then its desktop and phone shots side by side.
 * @param {{ key: string, name: string, note: string }} v
 * `badge` replaces the note, for the pick drawn once in the whole page; `upTo` is how far
 * down each shot must show (the feature's end in that page).
 * @param {{ desktop: Buffer, phone: Buffer, desktopWidth?: number, phoneWidth?: number,
 *   desktopUpTo?: number, phoneUpTo?: number }} shots
 * @param {{ pick?: boolean, title?: string, badge?: string }} opts
 */
export function cardHtml(v, shots, { pick = false, title = "", badge = "" } = {}) {
  const dw = shots.desktopWidth ?? 1280;
  const pw = shots.phoneWidth ?? 390;
  return `<!doctype html><style>${STYLE}</style><body>
<div class="head"><b>${label(v)}</b><span>${esc(badge || v.note || title)}</span>${pick ? '<em class="pick">my pick</em>' : ""}</div>
<div class="shots">
<figure><figcaption>Desktop, ${String(dw)} px</figcaption>${framed(shots.desktop, dw, 900, CARD_MAX, shots.desktopUpTo)}</figure>
<figure><figcaption>Phone, ${String(pw)} px</figcaption>${framed(shots.phone, pw, 390, CARD_MAX, shots.phoneUpTo)}</figure>
</div>`;
}

/**
 * Every variant small, a row each: its name and note, its desktop shot and its phone shot.
 * @param {Array<{ v: { key: string, name: string, note: string }, desktop: Buffer,
 *   phone: Buffer, desktopWidth?: number, phoneWidth?: number }>} list
 * @param {{ pick?: string, title?: string }} opts
 */
export function overviewHtml(list, { pick, title = "" } = {}) {
  const rows = list
    .map(
      (r) => `<div class="row${r.v.key === pick ? " on" : ""}">
<div><b>${label(r.v)}</b><span>${esc(r.v.note)}</span>${r.v.key === pick ? '<br><em class="pick">my pick</em>' : ""}</div>
${framed(r.desktop, r.desktopWidth ?? 1280, 860, ROW_MAX)}
${framed(r.phone, r.phoneWidth ?? 390, 260, ROW_MAX)}
</div>`,
    )
    .join("\n");
  return `<!doctype html><style>${STYLE}</style><body>
<div class="head"><b>${esc(title || "Variants")}</b><span>${String(list.length)} variants · desktop, then phone</span></div>
${rows}`;
}

/**
 * Draws a sheet's HTML as a JPEG the sheet's width, as tall as it runs.
 * @param {import("playwright-core").Browser} browser
 * @param {string} html
 */
export async function compose(browser, html) {
  const page = await browser.newPage({
    viewport: { width: SHEET_WIDTH, height: 400 },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await page.evaluate(markCuts);
    return await page.screenshot({ type: "jpeg", quality: 82, fullPage: true });
  } finally {
    await page.close();
  }
}
