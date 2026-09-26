// Turns a scene into a PNG: Satori lays it out to SVG with the bundled fonts, resvg rasterises it
// at twice the layout size so it stays sharp on high-density screens. Pure apart from reading
// the font files once at startup.
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { Resvg } from "@resvg/resvg-js"
import { Data, Effect } from "effect"
import satori, { type Font } from "satori"
import type { Improvement, ProfilePreview } from "../ports.js"
import { marbleSvg } from "./art.js"
import {
  CARD_WIDTH,
  cardScene,
  type CardImage,
  type El,
  FOOTER_WIDTH,
  footerScene,
  improvementScene,
  LINK_WIDTH,
  linkScene,
  ROW_WIDTH
} from "./scenes.js"

/** An image that couldn't be drawn: a font, layout or rasterising failure. */
export class RenderError extends Data.TaggedError("RenderError")<{ readonly cause: unknown }> {}

const SCALE = 2

type Weight = 400 | 500 | 600 | 700 | 800 | 900

/** Every face the scenes use, from the @fontsource packages (latin, then latin-ext for names). */
const FACES: ReadonlyArray<readonly [name: string, pkg: string, weight: Weight]> = [
  ["Nunito", "nunito", 800],
  ["Nunito", "nunito", 900],
  ["Chakra Petch", "chakra-petch", 500],
  ["Chakra Petch", "chakra-petch", 600],
  ["Chakra Petch", "chakra-petch", 700],
  ["Archivo", "archivo", 400],
  ["Archivo", "archivo", 600],
  ["Archivo", "archivo", 700],
  ["Bungee", "bungee", 400]
]

const loadFonts = Effect.fn("loadFonts")(function* () {
  const require = createRequire(import.meta.url)
  const fonts: Array<Font> = []
  for (const [name, pkg, weight] of FACES)
    for (const subset of ["latin", "latin-ext"]) {
      const path = require.resolve(`@fontsource/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff`)
      const data = yield* Effect.tryPromise({ try: () => readFile(path), catch: (cause) => new RenderError({ cause }) })
      fonts.push({ name, data, weight, style: "normal" })
    }
  return fonts
})

const rasterise = (svg: string) =>
  Effect.try({
    try: () => new Resvg(svg, { fitTo: { mode: "zoom", value: SCALE }, font: { loadSystemFonts: false } }).render().asPng(),
    catch: (cause) => new RenderError({ cause })
  })

export class Renderer extends Effect.Service<Renderer>()("multiballs/Renderer", {
  effect: Effect.gen(function* () {
    // Without its fonts the bot can draw nothing: that stops it at startup.
    const fonts = yield* loadFonts().pipe(Effect.orDie)
    const draw = Effect.fn("draw")(function* (scene: El, width: number) {
      const svg = yield* Effect.tryPromise({ try: () => satori(scene, { width, fonts }), catch: (cause) => new RenderError({ cause }) })
      return yield* rasterise(svg)
    })
    const footer = yield* Effect.cached(draw(footerScene(), FOOTER_WIDTH))

    return {
      /** The Match Card, in any state. */
      card: (card: CardImage) => draw(cardScene(card), CARD_WIDTH),
      improvement: (improvement: Improvement, name: string) => draw(improvementScene(improvement, name), ROW_WIDTH),
      footer,
      link: (preview: ProfilePreview) => draw(linkScene(preview), LINK_WIDTH),
      /** A bare marble, for the lifecycle-line emojis. */
      marble: (hue: number) => rasterise(marbleSvg(hue, 64))
    }
  })
}) {}
