// Pixel-art icons and the landscape scene. Framework-free: the Vue components render these rects in the browser and the
// markdown plugins turn them into SVG text at build time.
import data from './pixelData.json' with { type: 'json' }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
  fill: string
}

const ICONS = data.icons as Record<string, string[]>
const PALETTE = data.palette as Record<string, string>

export const ICON_NAMES: string[] = Object.keys(ICONS)

function iconRows(name: string): string[] {
  const rows = ICONS[name]
  if (!rows) throw new Error(`Unknown pixel icon "${name}"; known: ${ICON_NAMES.join(', ')}`)
  return rows
}

// Merge horizontal runs of one colour into single rects, to keep the SVG small.
function rects(rows: string[], x0 = 0, y0 = 0, palette: Record<string, string> = PALETTE): Rect[] {
  const out: Rect[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.') {
        x += 1
        continue
      }
      let run = x
      while (run < row.length && row[run] === ch) run += 1
      out.push({ x: x0 + x, y: y0 + y, width: run - x, height: 1, fill: palette[ch] })
      x = run
    }
  })
  return out
}

export interface IconShape {
  width: number
  height: number
  rects: Rect[]
}

export function iconShape(name: string): IconShape {
  const rows = iconRows(name)
  return { width: rows[0].length, height: rows.length, rects: rects(rows) }
}

function rectsSvg(list: Rect[]): string {
  return list.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${r.fill}"/>`).join('')
}

// The icon as SVG text, for markdown rendered at build time.
export function iconSvg(name: string, px = 3, className = 'pixel-icon'): string {
  const { width, height, rects: list } = iconShape(name)
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * px}" ` +
    `height="${height * px}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rectsSvg(list)}</svg>`
}

// Integer hash of a scene position, in [0, 1). The sky shader has the same function (sky.ts), so the WebGPU ground and
// the SVG one match pixel for pixel, and the scene does not reshuffle when it gets wider.
export function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export interface LandscapeOptions {
  width?: number       // scene pixels across; x runs from -width / 2 to width / 2
  height?: number
  groundTop?: number
  seed?: number
}

// The ground's colours, and how often each speckle appears.
export const GROUND = {
  grass: PALETTE.g, grassDark: PALETTE.G, dirt: PALETTE.d, dirtDark: PALETTE.D, stone: PALETTE.S, stoneLight: PALETTE.s,
  grassSpeckle: 0.35, dirtSpeckle: 0.12, stoneSpeckle: 0.25, stoneRows: 6,
}
// Night dims the foreground: each channel times `scale`, plus `add`.
export const MOONLIGHT = { scale: [0.42, 0.48, 0.66], add: [0.02, 0.03, 0.09] }

// A cloud: rects relative to its top-left corner, at x when the drift offset is 0.
export interface Cloud {
  x: number
  y: number
  layer: 'far' | 'near'
  rects: Rect[]
}

// A layer of clouds drifts right at `speed` scene pixels per second and wraps around a strip `span` wide, starting at
// -span / 2; the strip covers the scene plus a cloud's width on each side.
export interface CloudLayer {
  speed: number
  span: number
}

// A star twinkles with its own phase (radians) in the animated sky.
export interface Star extends Rect {
  phase: number
}

export interface LandscapeScene {
  width: number
  height: number
  groundTop: number
  seed: number
  daySky: Rect[]       // the striped skies of the static (SVG) scene
  nightSky: Rect[]
  sun: Rect[]
  moon: Rect[]
  stars: Star[]
  layers: Record<Cloud['layer'], CloudLayer>
  clouds: Cloud[]      // back to front
  trees: Rect[]
}

export const CLOUD_MARGIN = 16
const SMALL_CLOUD = ['..wwww....', '.wwwwwwww.', 'wwwwwwwwww']
const CLOUD_LAYERS = {
  far: { rows: SMALL_CLOUD, fill: '#e2f1ff', spacing: 34, speed: 0.5, top: 8, bottomGap: 22, id: 1 },
  near: { rows: ICONS.cloud, fill: undefined, spacing: 46, speed: 1, top: 2, bottomGap: 20, id: 2 },
}
const TREE_SPACING = 26

const NIGHT_PALETTE: Record<string, string> = { a: '#0e1640', A: '#142057', m: '#f4efd8', c: '#cfc5a4', w: '#ffffff', p: '#9fb0e6' }
const MOON = [
  '..mmmmm..',
  '.mmmmmmm.',
  'mmcmmmmmm',
  'mmmmmmcmm',
  'mmmmmmmmm',
  'mcmmmmmmm',
  'mmmmcmmmm',
  '.mmmmmmm.',
  '..mmmmm..',
]
const BRIGHT_STAR = ['.p.', 'pwp', '.p.']
const STAR_COLOURS = ['#ffffff', '#d4ddff', '#fff1c2']
const STAR_CELL = 8

function stripes(left: number, width: number, groundTop: number, light: string, dark: string): Rect[] {
  const out: Rect[] = []
  for (let y = 0; y < groundTop; y += 1) out.push({ x: left, y, width, height: 1, fill: Math.floor(y / 6) % 2 ? dark : light })
  return out
}

// Sky (day and night), sun, moon, stars, clouds and trees for a scene `width` scene pixels across, centred on x = 0.
// Everything is placed by position hashes, so a wider scene keeps what a narrower one had and adds more at the sides.
export function landscapeScene({ width = 180, height = 88, groundTop = 60, seed = 7 }: LandscapeOptions = {}): LandscapeScene {
  const left = -width / 2, right = width / 2
  const daySky = stripes(left, width, groundTop, PALETTE.b, PALETTE.B)
  const nightSky = stripes(left, width, groundTop, NIGHT_PALETTE.a, NIGHT_PALETTE.A)
  const sun = rects(ICONS.sun, Math.floor(right) - 17, 1)
  const moonX = Math.floor(right) - 16
  const moon = rects(MOON, moonX, 2, NIGHT_PALETTE)

  const stars: Star[] = []
  for (let cx = Math.floor(left / STAR_CELL); cx <= Math.ceil(right / STAR_CELL); cx += 1) {
    for (let cy = 0; cy < Math.floor((groundTop - 10) / STAR_CELL); cy += 1) {
      const roll = hash(cx, cy, seed + 3)
      if (roll >= 0.6) continue
      const x = cx * STAR_CELL + 1 + Math.floor(hash(cx, cy, seed + 4) * (STAR_CELL - 3))
      const y = cy * STAR_CELL + 1 + Math.floor(hash(cx, cy, seed + 5) * (STAR_CELL - 3))
      if (x > moonX - 3 && y < 14) continue  // not on the moon
      const phase = hash(cx, cy, seed + 6) * Math.PI * 2
      if (roll < 0.07) for (const r of rects(BRIGHT_STAR, x - 1, y - 1, NIGHT_PALETTE)) stars.push({ ...r, phase })
      else stars.push({ x, y, width: 1, height: 1, fill: STAR_COLOURS[Math.floor(hash(cx, cy, seed + 7) * 3)], phase })
    }
  }

  const layers = {} as Record<Cloud['layer'], CloudLayer>
  const clouds: Cloud[] = []
  for (const name of ['far', 'near'] as const) {
    const spec = CLOUD_LAYERS[name]
    const count = Math.ceil((width + 2 * CLOUD_MARGIN) / spec.spacing)
    const span = count * spec.spacing
    layers[name] = { speed: spec.speed, span }
    const shape = rects(spec.rows).map((r) => ({ ...r, fill: spec.fill ?? r.fill }))
    for (let k = 0; k < count; k += 1) {
      clouds.push({
        x: -span / 2 + k * spec.spacing + Math.floor(hash(k, spec.id, seed + 1) * spec.spacing * 0.5),
        y: spec.top + Math.floor(hash(k, spec.id, seed + 2) * (groundTop - spec.bottomGap - spec.top)),
        layer: name,
        rects: shape,
      })
    }
  }

  const trees: Rect[] = []
  const treeWidth = ICONS.tree[0].length
  for (let k = Math.floor(left / TREE_SPACING) - 1; k <= Math.ceil(right / TREE_SPACING) + 1; k += 1) {
    if (hash(k, 77, seed) < 0.12) continue
    const x = k * TREE_SPACING + Math.floor((hash(k, 78, seed) - 0.5) * 10) - Math.floor(treeWidth / 2)
    trees.push(...rects(ICONS.tree, x, groundTop - ICONS.tree.length))
  }
  return { width, height, groundTop, seed, daySky, nightSky, sun, moon, stars, layers, clouds, trees }
}

// The colour of ground pixel (x, y), y >= groundTop. The sky shader mirrors this.
export function groundColour(x: number, y: number, { height, groundTop, seed }: LandscapeScene): string {
  const roll = hash(x, y, seed)
  if (y === groundTop) return GROUND.grass
  if (y === groundTop + 1) return roll < GROUND.grassSpeckle ? GROUND.grassDark : GROUND.grass
  if (y < height - GROUND.stoneRows) return roll < GROUND.dirtSpeckle ? GROUND.dirtDark : GROUND.dirt
  return roll < GROUND.stoneSpeckle ? GROUND.stoneLight : GROUND.stone
}

// The ground from x0 to x1 as rects (for the SVG): one rect per row in its base colour, plus the speckles.
export function groundRects(scene: LandscapeScene, x0 = Math.floor(-scene.width / 2), x1 = Math.ceil(scene.width / 2)): Rect[] {
  const out: Rect[] = []
  for (let y = scene.groundTop; y < scene.height; y += 1) {
    const base = y <= scene.groundTop + 1 ? GROUND.grass : y < scene.height - GROUND.stoneRows ? GROUND.dirt : GROUND.stone
    out.push({ x: x0, y, width: x1 - x0, height: 1, fill: base })
    for (let x = x0; x < x1; x += 1) {
      const fill = groundColour(x, y, scene)
      if (fill !== base) out.push({ x, y, width: 1, height: 1, fill })
    }
  }
  return out
}

// A cloud's rects in scene coordinates at drift offset 0.
export function cloudRects(cloud: Cloud): Rect[] {
  return cloud.rects.map((r) => ({ ...r, x: r.x + cloud.x, y: r.y + cloud.y }))
}

// The whole static daytime scene.
export function landscapeRects(options: LandscapeOptions = {}): Rect[] {
  const scene = landscapeScene(options)
  return [...scene.daySky, ...scene.sun, ...scene.clouds.flatMap(cloudRects), ...scene.trees, ...groundRects(scene)]
}
