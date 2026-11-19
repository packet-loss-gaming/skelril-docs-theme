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
function rects(rows: string[], x0 = 0, y0 = 0): Rect[] {
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
      out.push({ x: x0 + x, y: y0 + y, width: run - x, height: 1, fill: PALETTE[ch] })
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

// Sky, sun, clouds, a few trees, and a grass, dirt and stone ground.
export function landscapeRects({ width = 68, height = 88, groundTop = 60, seed = 7 }: LandscapeOptions = {}): Rect[] {
  const random = prng(seed)
  const parts: Rect[] = []
  for (let y = 0; y < groundTop; y += 1) {
    parts.push({ x: 0, y, width, height: 1, fill: PALETTE[Math.floor(y / 6) % 2 ? 'B' : 'b'] })
  }
  parts.push(...rects(ICONS.sun, width - 17, 1))
  for (const [cx, cy] of [[4, 38], [44, 41], [2, 5]]) parts.push(...rects(ICONS.cloud, cx, cy))
  for (const tx of [5, 30, 52]) parts.push(...rects(ICONS.tree, tx, groundTop - ICONS.tree.length))

  parts.push({ x: 0, y: groundTop, width, height: 2, fill: PALETTE.g })
  for (let x = 0; x < width; x += 1) {
    if (random() < 0.35) parts.push({ x, y: groundTop + 1, width: 1, height: 1, fill: PALETTE.G })
  }
  const dirtEnd = height - 6
  parts.push({ x: 0, y: groundTop + 2, width, height: dirtEnd - groundTop - 2, fill: PALETTE.d })
  parts.push({ x: 0, y: dirtEnd, width, height: height - dirtEnd, fill: PALETTE.S })
  for (let y = groundTop + 2; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const roll = random()
      if (y < dirtEnd && roll < 0.12) parts.push({ x, y, width: 1, height: 1, fill: PALETTE.D })
      else if (y >= dirtEnd && roll < 0.25) parts.push({ x, y, width: 1, height: 1, fill: PALETTE.s })
    }
  }
  return parts
}
