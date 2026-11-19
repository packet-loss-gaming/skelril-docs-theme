// The landscape renderer's data: colours, the instance and uniform layouts, and the renderer interface.
import { GROUND, MOONLIGHT, type LandscapeScene, type Rect } from '../pixel.ts'

export const DAY = { top: '#4f9de6', horizon: '#bfe4ff' }
export const NIGHT = { top: '#070b24', horizon: '#26346a', clouds: '#5c6a90' }  // clouds: multiplies their daytime colour
export const TWINKLE_RATE = 1.3  // radians per second

// What an instance is: clouds are always drawn (tinted at night); the others belong to one time of day or are
// foreground (moonlit at night).
export const Kind = { Cloud: 0, Day: 1, Night: 2, Star: 3, Tree: 4 } as const
export type Kind = typeof Kind[keyof typeof Kind]
export const Layer = { None: 0, Far: 1, Near: 2 } as const

// One instance per rect, three vec4s: a = (x, y, width, height), b = (layer, kind, twinkle phase, x within the cloud),
// then the colour. A cloud's rects share its x and drift with its layer, wrapping around the layer's strip.
export const FLOATS_PER_INSTANCE = 12

// The uniforms, in floats, laid out like the shaders' std140 uniform block, so the array is uploaded as it is.
export const U = {
  size: 0,         // vec2: canvas size, device pixels
  scale: 2,        // device pixels per scene pixel (whole)
  twinkle: 3,      // radians
  origin: 4,       // vec2: scene (0, 0), device pixels: the middle of the top edge of the scene
  horizon: 6,      // ground line, device pixels from the top
  night: 7,        // 0 by day, 1 by night
  top: 8,          // vec4: sky colour at the top
  bottom: 12,      // vec4: sky colour at the horizon
  cloudTint: 16,   // vec4
  offsets: 20,     // vec2: drift of the far and near cloud layers, scene pixels
  spans: 22,       // vec2: width of the strip each layer wraps around, scene pixels
  seed: 24,
  groundTop: 25,
  sceneHeight: 26,
  count: 28,       // 112 bytes
} as const

export function rgba(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255).concat(1)
}

// Shader source helper: a colour as a GLSL vec3 literal.
export function vec3(hex: string): string {
  return `vec3(${rgba(hex).slice(0, 3).map((c) => c.toFixed(5)).join(', ')})`
}
export const MOONLIGHT_SCALE = MOONLIGHT.scale.map((c) => c.toFixed(3)).join(', ')
export const MOONLIGHT_ADD = MOONLIGHT.add.map((c) => c.toFixed(3)).join(', ')
export { GROUND }

export interface Instances {
  data: Float32Array<ArrayBuffer>
  back: number    // instances behind the ground (sun, moon, stars, clouds)
  trees: number   // instances in front of it, after the others
}

export function instances(scene: LandscapeScene): Instances {
  const data: number[] = []
  const add = (r: Rect, kind: Kind, layer: number = Layer.None, phase = 0, x = r.x, dx = 0) =>
    data.push(x, r.y, r.width, r.height, layer, kind, phase, dx, ...rgba(r.fill))
  for (const r of scene.sun) add(r, Kind.Day)
  for (const r of scene.moon) add(r, Kind.Night)
  for (const star of scene.stars) add(star, Kind.Star, Layer.None, star.phase)
  for (const cloud of scene.clouds) {
    const layer = cloud.layer === 'far' ? Layer.Far : Layer.Near
    for (const r of cloud.rects) add({ ...r, y: cloud.y + r.y }, Kind.Cloud, layer, 0, cloud.x, r.x)
  }
  const back = data.length / FLOATS_PER_INSTANCE
  for (const r of scene.trees) add(r, Kind.Tree)
  return { data: new Float32Array(data), back, trees: data.length / FLOATS_PER_INSTANCE - back }
}

// A renderer draws a frame as: the sky gradient, the instances behind the ground, the ground, then the trees.
export interface Renderer {
  maxSize: number
  setInstances(instances: Instances): void
  draw(uniforms: Float32Array<ArrayBuffer>): void
  // After the first frame: whether it worked. A renderer that fails here is destroyed by the caller.
  ready(): boolean
  destroy(): void
}
