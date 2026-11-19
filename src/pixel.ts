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

// Small deterministic PRNG (mulberry32) so the scene is identical on every build.
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface LandscapeOptions {
  width?: number
  height?: number
  groundTop?: number
  seed?: number
}

// A cloud: rects relative to its top-left corner, drifting right at `speed` scene pixels per second.
export interface Cloud {
  x: number
  y: number
  width: number
  speed: number
  far: boolean
  rects: Rect[]
}

// A star twinkles with its own phase (radians) in the animated sky.
export interface Star extends Rect {
  phase: number
}

export interface LandscapeScene {
  width: number
  height: number
  groundTop: number
  daySky: Rect[]       // the striped skies of the static (SVG) scene
  nightSky: Rect[]
  sun: Rect[]
  moon: Rect[]
  stars: Star[]
  clouds: Cloud[]      // back to front
  ground: Rect[]       // trees, grass, dirt and stone
}

// Distant clouds: smaller, paler and slower than the near ones.
const SMALL_CLOUD = ['..wwww....', '.wwwwwwww.', 'wwwwwwwwww']
export const CLOUD_MAX_WIDTH = 16
// Clouds wrap around a strip wider than the scene, so they leave on the right and come back in from the left.
export function cloudSpan(width: number): number {
  return width + CLOUD_MAX_WIDTH + 40
}
// The animated sky repeats every cycle: near clouds cross the strip twice per cycle, far clouds once, and the stars'
// twinkle fits it too. The animation runs on wall-clock time modulo the cycle, so every page shows the same sky.
export const SKY_CYCLE_SECONDS = 240

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

function stripes(width: number, groundTop: number, light: string, dark: string): Rect[] {
  const out: Rect[] = []
  for (let y = 0; y < groundTop; y += 1) out.push({ x: 0, y, width, height: 1, fill: Math.floor(y / 6) % 2 ? dark : light })
  return out
}

// Sky (day and night), sun, moon, stars, clouds, a few trees, and a grass, dirt and stone ground.
export function landscapeScene({ width = 68, height = 88, groundTop = 60, seed = 7 }: LandscapeOptions = {}): LandscapeScene {
  const random = prng(seed)
  const daySky = stripes(width, groundTop, PALETTE.b, PALETTE.B)
  const nightSky = stripes(width, groundTop, NIGHT_PALETTE.a, NIGHT_PALETTE.A)
  const sun = rects(ICONS.sun, width - 17, 1)
  const moon = rects(MOON, width - 16, 2, NIGHT_PALETTE)

  const starRandom = prng(seed + 2)
  const stars: Star[] = []
  const taken = new Set<string>()
  const free = (x: number, y: number) => !taken.has(`${x},${y}`) && !(x >= width - 18 && y < 13)  // not on the moon
  for (let i = 0; i < 7; i += 1) {
    const x = 1 + Math.floor(starRandom() * (width - 3)), y = 1 + Math.floor(starRandom() * (groundTop - 12))
    if (!free(x + 1, y + 1)) continue
    const phase = starRandom() * Math.PI * 2
    for (const r of rects(BRIGHT_STAR, x, y, NIGHT_PALETTE)) {
      stars.push({ ...r, phase })
      for (let dx = -1; dx <= r.width; dx += 1) for (let dy = -1; dy <= 1; dy += 1) taken.add(`${r.x + dx},${r.y + dy}`)
    }
  }
  for (let i = 0; i < Math.round(width * groundTop / 45); i += 1) {
    const x = Math.floor(starRandom() * width), y = Math.floor(starRandom() * (groundTop - 6))
    if (!free(x, y)) continue
    taken.add(`${x},${y}`)
    stars.push({ x, y, width: 1, height: 1, fill: STAR_COLOURS[Math.floor(starRandom() * 3)], phase: starRandom() * Math.PI * 2 })
  }

  const cloudRandom = prng(seed + 1)
  const far = rects(SMALL_CLOUD).map((r) => ({ ...r, fill: '#e2f1ff' }))
  const clouds: Cloud[] = []
  for (let i = 0; i < 3; i += 1) {
    const x = Math.floor((i + cloudRandom() * 0.6) * width / 3)
    clouds.push({ x, y: 10 + Math.floor(cloudRandom() * (groundTop - 20)), width: SMALL_CLOUD[0].length, speed: cloudSpan(width) / SKY_CYCLE_SECONDS, far: true, rects: far })
  }
  const near = rects(ICONS.cloud)
  for (const [x, y] of [[4, 38], [44, 41], [2, 5]]) {
    clouds.push({ x, y, width: ICONS.cloud[0].length, speed: 2 * cloudSpan(width) / SKY_CYCLE_SECONDS, far: false, rects: near })
  }

  const ground: Rect[] = []
  for (const tx of [5, 30, 52]) ground.push(...rects(ICONS.tree, tx, groundTop - ICONS.tree.length))
  ground.push({ x: 0, y: groundTop, width, height: 2, fill: PALETTE.g })
  for (let x = 0; x < width; x += 1) {
    if (random() < 0.35) ground.push({ x, y: groundTop + 1, width: 1, height: 1, fill: PALETTE.G })
  }
  const dirtEnd = height - 6
  ground.push({ x: 0, y: groundTop + 2, width, height: dirtEnd - groundTop - 2, fill: PALETTE.d })
  ground.push({ x: 0, y: dirtEnd, width, height: height - dirtEnd, fill: PALETTE.S })
  for (let y = groundTop + 2; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const roll = random()
      if (y < dirtEnd && roll < 0.12) ground.push({ x, y, width: 1, height: 1, fill: PALETTE.D })
      else if (y >= dirtEnd && roll < 0.25) ground.push({ x, y, width: 1, height: 1, fill: PALETTE.s })
    }
  }
  return { width, height, groundTop, daySky, nightSky, sun, moon, stars, clouds, ground }
}

// A cloud's rects in scene coordinates, where it starts.
export function cloudRects(cloud: Cloud): Rect[] {
  return cloud.rects.map((r) => ({ ...r, x: r.x + cloud.x, y: r.y + cloud.y }))
}

// The whole static daytime scene.
export function landscapeRects(options: LandscapeOptions = {}): Rect[] {
  const scene = landscapeScene(options)
  return [...scene.daySky, ...scene.sun, ...scene.clouds.flatMap(cloudRects), ...scene.ground]
}
