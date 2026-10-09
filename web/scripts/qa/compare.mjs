// Compares two screenshots of one view and draws the picture an agent reads instead of
// both: the reference, the target and the changes, cropped to where they differ. The
// pixels are read in Chromium's canvas, so this needs no image library.

// a channel differing by more than this counts as changed; text anti-aliasing stays under it
const TOLERANCE = 24;
// a picture wider or taller than this is scaled down to it
const MAX_SIDE = 1800;
const MARGIN = 24;
// the tallest stretch of changes one picture shows
const BAND = 700;

/**
 * `a` is the reference screenshot and `b` the target's, both PNG buffers. Returns how many
 * pixels changed, their bounding box, and when any did, the composite as a PNG buffer
 * labelled with `labels` and the rows of the page it shows (`shown`).
 */
export async function compare(browser, a, b, labels) {
  const page = await browser.newPage();
  try {
    const out = await page.evaluate(diffInPage, {
      a: a.toString("base64"),
      b: b.toString("base64"),
      labels,
      tolerance: TOLERANCE,
      maxSide: MAX_SIDE,
      margin: MARGIN,
      band: BAND,
    });
    return { ...out, image: out.image ? Buffer.from(out.image, "base64") : null };
  } finally {
    await page.close();
  }
}

async function diffInPage({ a, b, labels, tolerance, maxSide, margin, band }) {
  const load = async (src) => {
    const img = new Image();
    img.src = "data:image/png;base64," + src;
    await img.decode();
    return img;
  };
  const pixels = (img) => {
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, img.width, img.height);
  };
  const same = (p, x, y, q, u, v) => {
    const i = (y * p.width + x) * 4,
      j = (v * q.width + u) * 4;
    return (
      Math.abs(p.data[i] - q.data[j]) <= tolerance &&
      Math.abs(p.data[i + 1] - q.data[j + 1]) <= tolerance &&
      Math.abs(p.data[i + 2] - q.data[j + 2]) <= tolerance
    );
  };
  // anti-aliasing: an edge drawn a fraction of a pixel over, so each side's colour sits
  // one pixel away on the other side; that is not a change anyone would see
  const near = (p, x, y, q) => {
    for (let v = Math.max(0, y - 1); v <= Math.min(q.height - 1, y + 1); v++)
      for (let u = Math.max(0, x - 1); u <= Math.min(q.width - 1, x + 1); u++)
        if (same(p, x, y, q, u, v)) return true;
    return false;
  };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const da = pixels(ia),
    db = pixels(ib);
  const w = Math.max(ia.width, ib.width),
    h = Math.max(ia.height, ib.height);
  const mask = new Uint8Array(w * h);
  let changed = 0,
    x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x < ia.width && y < ia.height && x < ib.width && y < ib.height;
      if (inside && (same(da, x, y, db, x, y) || (near(da, x, y, db) && near(db, x, y, da))))
        continue;
      mask[y * w + x] = 1;
      changed++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const sizes = [
    [ia.width, ia.height],
    [ib.width, ib.height],
  ];
  if (!changed) return { changed, box: null, sizes, image: null };

  // the crop: the first run of changed rows (a gap of `margin` rows ends it), since what
  // follows is often the same change pushing the rest of the page down; at most `band`
  // tall, with a margin, the same window on all three panels
  const rowChanged = (y) => mask.subarray(y * w, (y + 1) * w).includes(1);
  let ry1 = y0;
  for (let y = y0, quiet = 0; y <= y1 && y - y0 < band && quiet < margin; y++)
    if (rowChanged(y)) [ry1, quiet] = [y, 0];
    else quiet++;
  let rx0 = w,
    rx1 = -1;
  for (let y = y0; y <= ry1; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) [rx0, rx1] = [Math.min(rx0, x), Math.max(rx1, x)];
  const cx = Math.max(0, rx0 - margin),
    cy = Math.max(0, y0 - margin);
  const cw = Math.min(w, rx1 + 1 + margin) - cx,
    ch = Math.min(h, ry1 + 1 + margin) - cy;
  const side = cw <= ch * 1.2; // tall or square crops sit side by side, wide ones stack
  const gap = 8,
    head = 22;
  const W = side ? cw * 3 + gap * 2 : cw,
    H = side ? ch + head : (ch + head) * 3 + gap * 2;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const c = new OffscreenCanvas(Math.ceil(W * scale), Math.ceil(H * scale));
  const g = c.getContext("2d");
  g.scale(scale, scale);
  g.fillStyle = "#111";
  g.fillRect(0, 0, W, H);
  // the changes: the target dimmed, each changed pixel in red
  const marks = new OffscreenCanvas(cw, ch);
  const mg = marks.getContext("2d");
  mg.globalAlpha = 0.35;
  mg.drawImage(ib, -cx, -cy);
  mg.globalAlpha = 1;
  const md = mg.getImageData(0, 0, cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      if (mask[(y + cy) * w + x + cx]) md.data.set([255, 40, 40, 255], (y * cw + x) * 4);
  mg.putImageData(md, 0, 0);
  const panels = [ia, ib, marks];
  panels.forEach((img, k) => {
    const px = side ? k * (cw + gap) : 0,
      py = side ? 0 : k * (ch + head + gap);
    g.fillStyle = "#ddd";
    g.font = "bold 14px sans-serif";
    g.fillText(labels[k], px + 4, py + 16);
    g.save();
    g.beginPath();
    g.rect(px, py + head, cw, ch);
    g.clip();
    if (img === marks) g.drawImage(marks, px, py + head);
    else g.drawImage(img, px - cx, py + head - cy);
    g.restore();
  });
  const blob = await c.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  // where the changes start: their top row and their reach across the next rows, which tells
  // one change shared by many pages (the header) from different ones
  let sx0 = w,
    sx1 = -1;
  for (let y = y0; y < Math.min(h, y0 + 48); y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) [sx0, sx1] = [Math.min(sx0, x), Math.max(sx1, x)];
  const sig = [y0, sx0, sx1].join(" ");
  return {
    changed,
    sig,
    box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
    shown: [cy, cy + ch],
    sizes,
    image: btoa(bin),
  };
}
