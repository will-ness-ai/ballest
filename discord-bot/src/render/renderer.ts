// Turns a scene into a PNG: Satori lays it out to SVG with the bundled fonts, resvg rasterises it
// at twice the layout size so it stays sharp on high-density screens. Pure apart from reading
// the font files once at startup.
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { Resvg } from "@resvg/resvg-js"
import { Effect } from "effect"
import satori, { type Font } from "satori"
import type { Improvement, ProfilePreview } from "../ports.js"
import { marbleSvg } from "./art.js"
import { cardScene, type CardImage, type El, footerScene, improvementScene, linkScene } from "./scenes.js"

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
      const data = yield* Effect.promise(() => readFile(path))
      fonts.push({ name, data, weight, style: "normal" })
    }
  return fonts
})

const rasterise = (svg: string) => new Resvg(svg, { fitTo: { mode: "zoom", value: SCALE }, font: { loadSystemFonts: false } }).render().asPng()

export class Renderer extends Effect.Service<Renderer>()("multiballs/Renderer", {
  effect: Effect.gen(function* () {
    const fonts = yield* loadFonts()
    const draw = Effect.fn("draw")(function* (scene: El, width: number) {
      const svg = yield* Effect.promise(() => satori(scene, { width, fonts }))
      return rasterise(svg)
    })
    const footer = yield* Effect.cached(draw(footerScene(), 520))

    return {
      /** The Match Card, in any state. */
      card: (card: CardImage) => draw(cardScene(card), 520),
      improvement: (improvement: Improvement, name: string) => draw(improvementScene(improvement, name), 420),
      footer,
      link: (preview: ProfilePreview) => draw(linkScene(preview), 400),
      /** A bare marble, for the lifecycle-line emojis. */
      marble: (hue: number) => Effect.sync(() => rasterise(marbleSvg(hue, 64)))
    } as const
  })
}) {}
