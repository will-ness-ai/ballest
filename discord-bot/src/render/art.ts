// Small SVG artwork shared by every image and the marble emojis: a Player's marble (the
// leaderboard site's, keyed by SteamID so a Player has one colour everywhere) and a Medal.
import type { MedalKind } from "../domain.js"

/** The site's hue for a SteamID (FNV-1a), so a marble here matches the one on ballest.willness.dev. */
export const hueFor = (seed: string): number => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % 360
}

/** The lime of the start line and the Multiballs logo's green marble. */
export const START_HUE = 96
/** The warm marble that heads a Result. */
export const RESULT_HUE = 50

/** The site's marble, as a standalone SVG. */
export const marbleSvg = (hue: number, size: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">` +
  `<defs><radialGradient id="g" cx="34%" cy="27%" r="80%">` +
  `<stop offset="0%" stop-color="hsl(${hue},94%,90%)"/><stop offset="34%" stop-color="hsl(${hue},80%,64%)"/><stop offset="100%" stop-color="hsl(${hue},62%,25%)"/>` +
  `</radialGradient><clipPath id="c"><circle cx="20" cy="20" r="19"/></clipPath></defs>` +
  `<circle cx="20" cy="20" r="19" fill="url(#g)"/>` +
  `<g clip-path="url(#c)"><path d="M-4 27C6 34 18 33 26 26s10-16 8-24" fill="none" stroke="hsl(${hue},66%,20%)" stroke-opacity=".26" stroke-width="4.5"/>` +
  `<path d="M2 8c8 2 16 8 19 17" fill="none" stroke="hsl(${hue},96%,92%)" stroke-opacity=".2" stroke-width="3"/></g>` +
  `<ellipse cx="13" cy="11.5" rx="5.4" ry="3.4" fill="#fff" fill-opacity=".62" transform="rotate(-28 13 11.5)"/>` +
  `<circle cx="20" cy="20" r="19" fill="none" stroke="hsl(${hue},60%,16%)" stroke-opacity=".35"/></svg>`

/** The game's medal gradient stops, dark to light. */
const MEDAL_STOPS: Record<MedalKind, readonly [string, string, string]> = {
  bronze: ["#9c6c1f", "#e0a650", "#f9cb85"],
  silver: ["#7a7a7a", "#c9c9c9", "#ffffff"],
  gold: ["#e0b800", "#ffe600", "#fff7b0"],
  author: ["#b86ae6", "#8fa2f0", "#5ef0f5"]
}

/** A medal drawing is 1.3 times as tall as it is wide. */
export const medalHeight = (width: number) => Math.round(width * 1.3)

/** A round medal on a ribbon, never a rectangle. `size` is its width. */
export const medalSvg = (kind: MedalKind, size: number): string => {
  const [dark, mid, light] = MEDAL_STOPS[kind]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${medalHeight(size)}" viewBox="0 0 20 26">` +
    `<defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>` +
    `<path d="M4 0h5l3 9H7z" fill="#1c2a4a"/><path d="M11 0h5l-3 9H8z" fill="#2d4476"/>` +
    `<circle cx="10" cy="16.5" r="8.4" fill="url(#m)" stroke="#111" stroke-width="1.4"/>` +
    `<circle cx="10" cy="16.5" r="5.4" fill="none" stroke="#111" stroke-opacity=".28" stroke-width="1.2"/>` +
    `<path d="M6.6 13.2a4.6 4.6 0 0 1 4.4-2.1" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.3" stroke-linecap="round"/></svg>`
  )
}

/** The game's medal bar gradients (left to right). */
export const MEDAL_BAR: Record<MedalKind, string> = {
  bronze: "linear-gradient(90deg, #b07f2a, #e0a650 45%, #f9cb85)",
  silver: "linear-gradient(90deg, #808080, #c9c9c9 45%, #ffffff)",
  gold: "linear-gradient(90deg, #ffe600, #fff27a 50%, #fff7b0)",
  author: "linear-gradient(90deg, #b86ae6, #8fa2f0 50%, #5ef0f5)"
}

export const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
