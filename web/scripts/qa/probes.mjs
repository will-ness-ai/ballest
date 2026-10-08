// The layout probes, run in the page by browser.mjs. Each is serialized on its own by
// page.evaluate, so everything one uses lives inside it.

/*
 * Four faults a reader sees whatever the design meant:
 * - overflow: the page scrolls sideways;
 * - offscreen: an element reaches past the viewport with nothing clipping or scrolling it;
 * - clipped: text cut off by its box with no ellipsis to say so, or a placeholder wider
 *   than its field;
 * - overlap: a line of text drawn over another.
 * Each is reported at its outermost element, as a short selector.
 */
export function probe() {
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    if (el.id) return "#" + el.id;
    const cls = [...el.classList].slice(0, 2).join(".");
    const parent = el.parentElement;
    const own = el.tagName.toLowerCase() + (cls ? "." + cls : "");
    if (cls || !parent || parent === document.body) return own;
    return label(parent) + " > " + own;
  };
  const visible = (el, r) =>
    r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  // an ancestor that clips or scrolls sideways, which makes reaching past the viewport fine
  const held = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
      if (getComputedStyle(a).overflowX !== "visible") return true;
    return false;
  };
  const offscreen = new Map();
  const clipped = new Map();
  const pastOf = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 ? Math.max(r.right - vw, -r.left) : 0;
  };
  const add = (map, el, px, inner = el) => {
    const k = label(el) + (inner === el ? "" : " … " + label(inner));
    map.set(k, Math.max(map.get(k) ?? 0, Math.round(px)));
  };
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("[hidden], [aria-hidden=true], dialog:not([open])")) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const past = pastOf(el);
    if (past > 1 && !held(el) && !(pastOf(el.parentElement) > 1)) {
      // name the outermost element and, inside it, the one holding it open: follow down the
      // child whose hiding lets the box back in, or when several each hold it (cards in a
      // column), the one whose content is widest
      let inner = el;
      for (;;) {
        const wide = [...inner.children].filter((c) => pastOf(c) > 1);
        if (!wide.length) break;
        const frees = (c) => {
          const keep = c.style.display;
          c.style.display = "none";
          const freed = pastOf(el) < past - 1;
          c.style.display = keep;
          return freed;
        };
        // the widest by its own content, not by the width it was stretched to
        const least = (c) => {
          const keep = c.style.width;
          c.style.width = "min-content";
          const w = c.getBoundingClientRect().width;
          c.style.width = keep;
          return w;
        };
        inner =
          wide.find(frees) ??
          wide.map((c) => [c, least(c)]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      }
      add(offscreen, el, past, inner);
    }
    const cs = getComputedStyle(el);
    if (
      (cs.overflowX === "hidden" || cs.overflowX === "clip") &&
      cs.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1 &&
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    )
      add(clipped, el, el.scrollWidth - el.clientWidth);
  }
  // a placeholder is drawn inside the field and cut at its edge, which no scrollWidth shows
  const pen = document.createElement("canvas").getContext("2d");
  for (const el of document.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    const r = el.getBoundingClientRect();
    if (el.value || !visible(el, r) || el.closest("[hidden], dialog:not([open])")) continue;
    const cs = getComputedStyle(el);
    pen.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const over = pen.measureText(el.placeholder).width - room;
    if (over > 1) add(clipped, el, over);
  }
  /* lines of text drawn over other text. Each line is cut to the boxes
     that clip it (an ellipsis hides the rest), and only the open dialog counts while one is. */
  function overlaps() {
    const modal = document.querySelector("dialog[open]:modal");
    const clips = new Map();
    const clipOf = (el) => {
      if (!el || el === document.body) return null;
      if (clips.has(el)) return clips.get(el);
      let c = clipOf(el.parentElement);
      const cs = getComputedStyle(el);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const r = el.getBoundingClientRect();
        c = c
          ? {
              l: Math.max(c.l, r.left),
              t: Math.max(c.t, r.top),
              r: Math.min(c.r, r.right),
              b: Math.min(c.b, r.bottom),
            }
          : { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }
      clips.set(el, c);
      return c;
    };
    const lines = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el) continue;
      if (el.closest("[hidden], [aria-hidden=true], dialog:not([open]), script, style")) continue;
      if (modal && !modal.contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const c = clipOf(el);
      for (const r of range.getClientRects()) {
        // the middle of the line box: glyphs, not the leading above and below them
        const pad = r.height * 0.25;
        const box = { l: r.left, t: r.top + pad, r: r.right, b: r.bottom - pad };
        if (c)
          Object.assign(box, {
            l: Math.max(box.l, c.l),
            t: Math.max(box.t, c.t),
            r: Math.min(box.r, c.r),
            b: Math.min(box.b, c.b),
          });
        if (box.r - box.l > 1 && box.b - box.t > 1) lines.push({ n, el, ...box });
      }
    }
    lines.sort((a, b) => a.t - b.t);
    const found = new Map();
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length && lines[j].t < lines[i].b; j++) {
        const a = lines[i],
          b = lines[j];
        if (a.n === b.n) continue;
        const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        if (w <= 2) continue;
        const k = label(a.el) + " × " + label(b.el);
        found.set(k, Math.max(found.get(k) ?? 0, Math.round(w)));
      }
    return [...found].slice(0, 5);
  }

  const doc = document.scrollingElement;
  return {
    height: doc.scrollHeight,
    // where the page put itself on load (an entry page scrolls to its row)
    scrolled: Math.round(scrollY),
    overflow: Math.max(0, doc.scrollWidth - vw),
    offscreen: [...offscreen],
    clipped: [...clipped],
    overlap: overlaps(),
  };
}

/* each match's box, rounded, with the start of its text */
export function measure(selector) {
  return [...document.querySelectorAll(selector)].slice(0, 40).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      right: Math.round(r.right),
      y: Math.round(r.top + scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30),
    };
  });
}
