// sheet.mjs's pictures: a grill-design round's variants drawn so Will can judge them
// in the thread without opening the preview. Each variant gets a card (its name and note over
// its desktop shot in a browser window and its phone shot in a phone, side by side, at a size
// that reads on a phone), and the round gets an overview (a row per variant, small) to compare
// them at a glance. Both are drawn as HTML in the browser and saved as JPEG. A round that isn't
// a page (a Multiballs image, a game screenshot) brings one picture per variant instead, drawn
// the same way: its letter, name and note over each, the overview side by side when they are tall.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SHEET_WIDTH = 1400;
// the tallest stretch of a shot a picture shows; the rest is cut, and the cut says how much
const CARD_MAX = 1100;
const ROW_MAX = 520;

/**
 * The round's variants: the picker's own list, which ProtoPicker publishes as
 * `data-variants`, a JSON array of [key, name, note?], cut to --variants (keys,
 * comma-separated) when given. A page with no list takes --variants as they are. Every key
 * asked for, and the pick, must be one the list has; when not, or when nothing names any
 * variant, it says what is wrong and what to do instead.
 * @param {string | null} published
 * @param {{ variants?: string, pick?: string }} flags
 * @returns {{ variants: Array<{ key: string, name: string, note: string }> } |
 *   { error: string, help: string }}
 */
export function variantsOf(published, { variants: flag, pick } = {}) {
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
  const asked = (flag ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const chosen = asked.length
    ? asked.map((key) => all.find((v) => v.key === key) ?? { key, name: "", note: "" })
    : all;
  if (!chosen.length)
    return {
      error: "the page has no variant picker listing its variants",
      help: "name them: --variants A,B,C, or give ProtoPicker data-variants",
    };
  const keys = (all.length ? all : chosen).map((v) => v.key);
  const strange = chosen.filter((v) => !keys.includes(v.key) || !/^[\w-]+$/.test(v.key));
  if (strange.length)
    return {
      error: `no variant ${strange.map((v) => `"${v.key}"`).join(", ")}`,
      help: `variants: ${keys.join(", ")}`,
    };
  if (pick && !keys.includes(pick))
    return { error: `no variant "${pick}" to pick`, help: `variants: ${keys.join(", ")}` };
  return { variants: chosen };
}

const PICTURE_TYPES = [".png", ".jpg", ".jpeg", ".webp"];

/**
 * A round drawn as pictures rather than a page: `dir` holds `variants.json` (the picker's
 * shape, [key, name, note] each) and one picture per variant, named by its key (`A.png`,
 * `B.jpg`, ...). Gives each variant with its picture's path, cut to --variants, or says what
 * is missing and how to add it.
 * @param {string} dir
 * @param {{ variants?: string, pick?: string }} flags
 * @returns {{ variants: Array<{ key: string, name: string, note: string, file: string }> } |
 *   { error: string, help: string }}
 */
export function imagesOf(dir, flags = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    return { error: `no folder ${dir}`, help: "--images names the folder holding the pictures" };
  const listFile = join(dir, "variants.json");
  if (!existsSync(listFile))
    return {
      error: `no ${listFile}`,
      help: `write it beside the pictures: [["A", "<name>", "<what it changes>"], ...], one entry a picture (A.png, B.png, ...)`,
    };
  const shape = `[["A", "<name>", "<what it changes>"], ...]`;
  let listed;
  try {
    listed = JSON.parse(readFileSync(listFile, "utf8"));
  } catch (e) {
    return { error: `${listFile} isn't JSON: ${String(e.message)}`, help: `write it as ${shape}` };
  }
  if (!Array.isArray(listed) || !listed.some((e) => Array.isArray(e) && e.length > 0))
    return { error: `${listFile} lists no variants`, help: `write it as ${shape}` };
  const asked = variantsOf(JSON.stringify(listed), flags);
  if ("error" in asked) return asked;
  const variants = [];
  for (const v of asked.variants) {
    const file = PICTURE_TYPES.map((t) => join(dir, v.key + t)).find((f) => existsSync(f));
    if (!file)
      return {
        error: `no picture for ${v.key}`,
        help: `save it as ${join(dir, v.key + ".png")} (or .jpg, .jpeg, .webp)`,
      };
    variants.push({ ...v, file });
  }
  return { variants };
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
/* a picture as a data URI, its type read from its first bytes (JPEG, WebP, else PNG) */
const uri = (bytes) => {
  const b = Buffer.from(bytes);
  const type =
    b[0] === 0xff && b[1] === 0xd8
      ? "jpeg"
      : b.toString("latin1", 8, 12) === "WEBP"
        ? "webp"
        : "png";
  return `data:image/${type};base64,${b.toString("base64")}`;
};
/* the variant's letter, big, then its name */
const label = (v) => `<b class="key">${esc(v.key)}</b>${v.name ? `<b>${esc(v.name)}</b>` : ""}`;

const STYLE = `
*{box-sizing:border-box}
body{margin:0;width:${String(SHEET_WIDTH)}px;background:#0d1020;color:#eef0fa;font:18px/1.35 system-ui,sans-serif}
.head{display:flex;gap:16px;align-items:baseline;padding:18px 24px 12px}
.head b{font-size:34px}
.key{display:inline-grid;place-items:center;min-width:1.5em;height:1.5em;padding:0 .25em;border-radius:12px;background:#eef0fa;color:#0d1020;font-weight:800;line-height:1}
.head .key{font-size:34px}
.head span{color:#a9b0cf;font-size:20px}
.pick{margin-left:auto;white-space:nowrap;font-style:normal;padding:4px 12px;border-radius:99px;background:#9be15d;color:#132;font-weight:700;font-size:18px}
.shots{display:flex;gap:24px;align-items:flex-start;padding:0 24px 24px}
figure{margin:0;display:grid;gap:6px}
figcaption{color:#7d85a8;font-size:15px}
.frame{position:relative;overflow:hidden;background:#0b0e1a}
.frame img{display:block;width:100%}
.browser{border:1px solid #3a4266;border-radius:10px;overflow:hidden;background:#1f2438;box-shadow:0 8px 28px #0008}
.bar{display:flex;gap:7px;align-items:center;height:30px;padding:0 10px}
.bar i{width:11px;height:11px;border-radius:50%;background:#ff5f57}
.bar i:nth-child(2){background:#febc2e}
.bar i:nth-child(3){background:#28c840}
.bar u{flex:1;margin:0 40px 0 12px;padding:3px 12px;border-radius:7px;background:#11142a;color:#a9b0cf;font-size:12px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phone{padding:10px;border:2px solid #3a4266;border-radius:var(--r);background:#05060c;box-shadow:0 8px 28px #0008}
.phone .frame{border-radius:calc(var(--r) - 10px)}
.status{display:flex;align-items:center;justify-content:space-between;height:var(--sb);padding:0 18px;color:#eef0fa;font-size:calc(var(--sb) * 0.42);font-weight:600}
.status em{width:28%;height:62%;border-radius:99px;background:#000;border:1px solid #1d2135}
.status b{width:18%;height:34%;border-radius:3px;background:linear-gradient(90deg,#eef0fa 70%,#555 70%)}
.home{height:calc(var(--sb) * 0.6);display:grid;place-items:center}
.home i{width:34%;height:4px;border-radius:99px;background:#eef0fa}
.cut{position:absolute;inset:auto 0 0;padding:28px 10px 8px;background:linear-gradient(transparent,#0d1020 70%);color:#a9b0cf;font-size:14px;text-align:center}
.row{display:grid;grid-template-columns:200px 1fr 260px;gap:16px;align-items:start;padding:14px 24px;border-top:1px solid #2c3355}
.row b{font-size:24px;display:block}
.row .key{display:inline-grid;font-size:40px;margin-bottom:6px}
.row span{color:#a9b0cf;font-size:15px}
.row.on{background:#17202e}
.grid{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));gap:16px;align-items:start;padding:0 24px 24px}
.cell{display:grid;gap:8px;padding:10px;border-radius:12px}
.cell.on{background:#17202e;outline:2px solid #9be15d}
.cell .name{display:flex;gap:10px;align-items:center;font-size:22px}
.cell .key{font-size:40px}
.cell span{color:#a9b0cf;font-size:15px}
.cell img,.picture img{display:block;width:100%}
.picture{margin:0 24px 24px;width:fit-content;max-width:${String(SHEET_WIDTH - 48)}px}
`;

/* a shot on a screen `width` wide, cut at `max` px of the screen's height (or where the
   shot's own `upTo` px falls, when that is lower down), the cut said */
function screen(png, shotWidth, width, max, upTo) {
  const scale = width / shotWidth;
  const cut = upTo ? Math.max(max, Math.ceil((upTo + 24) * scale)) : max;
  return `<div class="frame" style="width:${String(width)}px;max-height:${String(cut)}px"><img src="${uri(png)}" data-scale="${String(scale)}"><div class="cut" hidden></div></div>`;
}

/* the desktop shot in a browser window `width` wide, its address in the bar */
function inBrowser(png, shotWidth, width, max, upTo, address) {
  return `<div class="browser" style="width:${String(width)}px"><div class="bar"><i></i><i></i><i></i><u>${esc(address)}</u></div>${screen(png, shotWidth, width - 2, max, upTo)}</div>`;
}

/* the phone shot in a phone `width` wide: bezel, status bar with its island, home bar */
function inPhone(png, shotWidth, width, max, upTo) {
  const inner = width - 24;
  const r = Math.round(width * 0.13);
  const sb = Math.round(inner * 0.1);
  return `<div class="phone" style="width:${String(width)}px;--r:${String(r)}px;--sb:${String(sb)}px"><div class="frame" style="width:${String(inner)}px"><div class="status"><span>9:41</span><em></em><b></b></div>${screen(png, shotWidth, inner, max, upTo)}<div class="home"><i></i></div></div></div>`;
}

/* marks each frame whose picture runs past it with how much is cut, in the shot's own px */
function markCuts() {
  for (const f of document.querySelectorAll(".frame:has(> img)")) {
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
 * `address` is the page's, shown in the browser's bar.
 * @param {{ pick?: boolean, title?: string, badge?: string, address?: string }} opts
 */
export function cardHtml(v, shots, { pick = false, title = "", badge = "", address = "" } = {}) {
  const dw = shots.desktopWidth ?? 1280;
  const pw = shots.phoneWidth ?? 390;
  return `<!doctype html><style>${STYLE}</style><body>
<div class="head">${label(v)}<span>${esc(badge || v.note || title)}</span>${pick ? '<em class="pick">my pick</em>' : ""}</div>
<div class="shots">
<figure><figcaption>Desktop, ${String(dw)} px</figcaption>${inBrowser(shots.desktop, dw, 900, CARD_MAX, shots.desktopUpTo, address)}</figure>
<figure><figcaption>Phone, ${String(pw)} px</figcaption>${inPhone(shots.phone, pw, 414, CARD_MAX, shots.phoneUpTo)}</figure>
</div>`;
}

/**
 * Every variant small, a row each: its name and note, its desktop shot and its phone shot.
 * @param {Array<{ v: { key: string, name: string, note: string }, desktop: Buffer,
 *   phone: Buffer, desktopWidth?: number, phoneWidth?: number }>} list
 * @param {{ pick?: string, title?: string, address?: string }} opts
 */
export function overviewHtml(list, { pick, title = "", address = "" } = {}) {
  const rows = list
    .map(
      (r) => `<div class="row${r.v.key === pick ? " on" : ""}">
<div>${label(r.v)}<span>${esc(r.v.note)}</span>${r.v.key === pick ? '<br><em class="pick">my pick</em>' : ""}</div>
${inBrowser(r.desktop, r.desktopWidth ?? 1280, 860, ROW_MAX, undefined, address)}
${inPhone(r.phone, r.phoneWidth ?? 390, 260, ROW_MAX)}
</div>`,
    )
    .join("\n");
  return `<!doctype html><style>${STYLE}</style><body>
<div class="head"><b>${esc(title || "Variants")}</b><span>${String(list.length)} variants · desktop, then phone</span></div>
${rows}`;
}

/**
 * One variant's card from its picture: its letter, name and note over the whole picture, at its
 * own size up to the sheet's width.
 * @param {{ key: string, name: string, note: string }} v
 * @param {Buffer} picture
 * @param {{ pick?: boolean, title?: string }} opts
 */
export function pictureCardHtml(v, picture, { pick = false, title = "" } = {}) {
  return `<!doctype html><style>${STYLE}</style><body>
<div class="head">${label(v)}<span>${esc(v.note || title)}</span>${pick ? '<em class="pick">my pick</em>' : ""}</div>
<div class="picture"><img src="${uri(picture)}"></div>`;
}

/**
 * Every variant's picture in one overview, each under its letter, name and note: side by side
 * when they are tall (up to five a row), fewer a row as they get wider (see `arrange`).
 * @param {Array<{ v: { key: string, name: string, note: string }, picture: Buffer }>} list
 * @param {{ pick?: string, title?: string }} opts
 */
export function pictureOverviewHtml(list, { pick, title = "" } = {}) {
  const cells = list
    .map(
      (r) => `<div class="cell${r.v.key === pick ? " on" : ""}">
<div class="name">${label(r.v)}${r.v.key === pick ? '<em class="pick">my pick</em>' : ""}</div>
${r.v.note ? `<span>${esc(r.v.note)}</span>` : ""}
<img src="${uri(r.picture)}">
</div>`,
    )
    .join("\n");
  return `<!doctype html><style>${STYLE}</style><body>
<div class="head"><b>${esc(title || "Variants")}</b><span>${String(list.length)} variant${list.length === 1 ? "" : "s"}</span></div>
<div class="grid">${cells}</div>`;
}

/* sets each overview grid's columns from its widest picture's shape, so none is drawn too
   small to read: up to five a row when tall, three when about square, two when wide, one
   when very wide; rows kept even (6 -> 3 + 3) */
function arrange() {
  for (const g of document.querySelectorAll(".grid")) {
    const imgs = [...g.querySelectorAll("img")];
    if (!imgs.length) continue;
    const aspect = Math.max(...imgs.map((i) => i.naturalWidth / Math.max(1, i.naturalHeight)));
    const most = aspect < 0.75 ? 5 : aspect < 1.3 ? 3 : aspect < 1.8 ? 2 : 1;
    const per = Math.min(imgs.length, most);
    g.style.setProperty("--cols", String(Math.ceil(imgs.length / Math.ceil(imgs.length / per))));
  }
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
    await page.evaluate(arrange);
    await page.evaluate(markCuts);
    return await page.screenshot({ type: "jpeg", quality: 82, fullPage: true });
  } finally {
    await page.close();
  }
}
