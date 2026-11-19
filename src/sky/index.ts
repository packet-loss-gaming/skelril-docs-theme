// The landscape, drawn with WebGL2 and sized to the canvas: blocks are a whole number of device
// pixels (fitted to the canvas height, rounded down, ground at the bottom) and the scene is as many scene pixels wide
// as fit, so wider screens get more trees, clouds and stars rather than a zoomed-in picture. By day: a gradient sky,
// the sun and drifting block clouds. By night (dark mode: VitePress' html.dark class): the moon, twinkling block stars,
// slate clouds and a moonlit foreground. Clouds drift on wall-clock time, so every page (and every reload) shows the
// same sky.
import { landscapeScene, type LandscapeScene } from '../pixel.ts'
import { DAY, instances, NIGHT, rgba, TWINKLE_RATE, U, type Renderer } from './common.ts'
import { webglRenderer } from './webgl.ts'

export interface SkyOptions {
  height: number       // scene pixels, ground included
  groundTop: number
  seed: number
  animate: boolean
  // Called if the WebGL context is lost after the landscape started.
  onLost: () => void
}

function isNight(): boolean {
  return document.documentElement.classList.contains('dark')
}

// Starts drawing the landscape into the canvas. Returns a stop function once the first frame is drawn, or null without
// WebGL2 (the canvas then keeps its CSS background).
export function startSky(canvas: HTMLCanvasElement, options: SkyOptions): (() => void) | null {
  let stopped = false
  const lost = () => {
    if (stopped) return
    stop()
    options.onLost()
  }
  const renderer: Renderer | null = webglRenderer(canvas, lost)
  if (!renderer) return null

  const uniforms = new Float32Array(U.count)
  uniforms.set(rgba(NIGHT.clouds), U.cloudTint)
  uniforms[U.seed] = options.seed
  uniforms[U.groundTop] = options.groundTop
  uniforms[U.sceneHeight] = options.height
  function setTimeOfDay() {
    const night = isNight()
    uniforms.set(rgba(night ? NIGHT.top : DAY.top), U.top)
    uniforms.set(rgba(night ? NIGHT.horizon : DAY.horizon), U.bottom)
    uniforms[U.night] = night ? 1 : 0
  }
  setTimeOfDay()

  // The scene for the current width, rebuilt when the canvas gets wider or narrower in scene pixels.
  let scene: LandscapeScene | null = null
  function layout(sceneWidth: number): LandscapeScene {
    if (scene?.width === sceneWidth) return scene
    scene = landscapeScene({ width: sceneWidth, height: options.height, groundTop: options.groundTop, seed: options.seed })
    renderer!.setInstances(instances(scene))
    uniforms[U.spans] = scene.layers.far.span
    uniforms[U.spans + 1] = scene.layers.near.span
    return scene
  }

  // Wall-clock seconds, in double precision here: the shaders only get each layer's offset and the twinkle angle.
  const frozen = Date.now()
  function draw() {
    if (stopped || canvas.width === 0 || canvas.height === 0) return
    const w = canvas.width, h = canvas.height
    const scale = Math.max(1, Math.floor(h / options.height))  // whole device pixels; spare height is more sky
    const current = layout(Math.ceil(w / scale / 2) * 2 + 2)  // even, and a pixel spare at each side
    const now = (options.animate ? Date.now() : frozen) / 1000
    uniforms[U.size] = w
    uniforms[U.size + 1] = h
    uniforms[U.scale] = scale
    uniforms[U.twinkle] = (now * TWINKLE_RATE) % (Math.PI * 2)
    uniforms[U.origin] = Math.round(w / 2)
    uniforms[U.origin + 1] = h - options.height * scale
    uniforms[U.horizon] = uniforms[U.origin + 1] + options.groundTop * scale
    uniforms[U.offsets] = (now * current.layers.far.speed) % current.layers.far.span
    uniforms[U.offsets + 1] = (now * current.layers.near.speed) % current.layers.near.span
    renderer!.draw(uniforms)
  }

  // Size the canvas in device pixels; redraw at once so a resize never shows a stretched frame.
  function resize(width: number, height: number) {
    canvas.width = Math.max(1, Math.min(renderer!.maxSize, Math.round(width)))
    canvas.height = Math.max(1, Math.min(renderer!.maxSize, Math.round(height)))
    draw()
  }
  const box = canvas.getBoundingClientRect()
  resize(box.width * devicePixelRatio, box.height * devicePixelRatio)
  const resizer = new ResizeObserver(([entry]) => {
    const exact = entry.devicePixelContentBoxSize?.[0]
    if (exact) resize(exact.inlineSize, exact.blockSize)
    else resize(entry.contentRect.width * devicePixelRatio, entry.contentRect.height * devicePixelRatio)
  })
  try {
    resizer.observe(canvas, { box: 'device-pixel-content-box' })
  } catch {
    resizer.observe(canvas)
  }

  // Follow dark mode as it changes (with appearance: 'force-auto', when the system theme changes).
  const themeWatcher = new MutationObserver(() => {
    setTimeOfDay()
    draw()
  })
  themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  // Animate only while the landscape is on screen (requestAnimationFrame already pauses in background tabs).
  let frame = 0
  let visible = false
  function tick() {
    draw()
    frame = visible ? requestAnimationFrame(tick) : 0
  }
  const watcher = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible && options.animate && !frame) frame = requestAnimationFrame(tick)
  })
  watcher.observe(canvas)

  function stop() {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    resizer.disconnect()
    watcher.disconnect()
    themeWatcher.disconnect()
    renderer!.destroy()
  }
  if (!renderer.ready()) {
    stop()
    return null
  }
  return stopped ? null : stop
}
