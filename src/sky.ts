/// <reference types="@webgpu/types" />
// The landscape's sky as a WebGPU scene: a vertical gradient with the sun and block clouds drifting across it by day,
// and the moon and twinkling block stars by night (dark mode: VitePress' html.dark class). It draws in the same scene
// pixels as the SVG landscape (fitted like preserveAspectRatio="xMidYMid slice"), so the SVG foreground lines up on
// top. Browsers without WebGPU keep the static SVG sky. Time is wall-clock time modulo SKY_CYCLE_SECONDS, so every
// page (and every reload) shows the sky at the same moment.
import { CLOUD_MAX_WIDTH, cloudSpan, SKY_CYCLE_SECONDS, type LandscapeScene, type Rect } from './pixel.ts'

const DAY = { top: '#4f9de6', horizon: '#bfe4ff' }
const STAR_CSS_PX = 6
const TWINKLES_PER_CYCLE = 50
const NIGHT = { top: '#070b24', horizon: '#26346a', clouds: '#5c6a90' }  // clouds: multiplies their daytime colour

// What an instance is: clouds are always drawn (tinted at night); the others belong to one time of day.
const Kind = { Cloud: 0, Day: 1, Night: 2, Star: 3 } as const
type Kind = typeof Kind[keyof typeof Kind]

const SHADER = /* wgsl */ `
struct Uniforms {
  size: vec2f,      // canvas size, device pixels
  scale: f32,       // device pixels per scene pixel
  time: f32,        // seconds into the cycle
  offset: vec2f,    // scene origin, device pixels
  horizon: f32,     // ground line, device pixels from the top
  span: f32,        // width of the strip clouds wrap around, scene pixels
  top: vec4f,
  bottom: vec4f,
  cloudTint: vec4f,
  night: f32,       // 0 by day, 1 by night
  starPx: f32,      // largest star block, device pixels
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex fn skyVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));  // one triangle covering the canvas
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn skyFragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return mix(u.top, u.bottom, clamp(p.y / max(u.horizon, 1.0), 0.0, 1.0));
}

struct Block {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

// One instance per rect: a = (x, x offset, y, width), b = (height, speed or star centre y, kind, twinkle phase). A cloud's
// rects share its x and drift with it; a star's rects share its centre (x, b.y) and shrink towards it when blocks get big.
@vertex fn blockVertex(@builtin(vertex_index) i: u32, @location(0) a: vec4f, @location(1) b: vec4f,
                       @location(2) color: vec4f) -> Block {
  var out: Block;
  let kind = u32(b.z);
  let night = u.night > 0.5;
  if ((kind == 1u && night) || (kind >= 2u && !night)) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);  // not this time of day: outside the clip volume
    return out;
  }
  let corner = vec2f(f32(i == 1u || i == 2u || i == 4u), f32(i >= 2u && i != 3u));
  let margin = ${CLOUD_MAX_WIDTH.toFixed(1)};
  var x = a.x;
  if (kind == 0u) {
    x = (a.x + margin + b.y * u.time) % u.span - margin;
  }
  var scene = vec2f(x + a.y, a.z) + corner * vec2f(a.w, b.x);
  if (kind == 3u) {
    let centre = vec2f(a.x, b.y);
    scene = centre + (scene - centre) * min(1.0, u.starPx / u.scale);
  }
  // Snap edges to device pixels so the blocks stay crisp while they move.
  let px = round(scene * u.scale + u.offset);
  out.position = vec4f(px.x / u.size.x * 2.0 - 1.0, 1.0 - px.y / u.size.y * 2.0, 0.0, 1.0);
  var rgb = color.rgb;
  if (kind == 0u) {
    rgb *= mix(vec3f(1.0), u.cloudTint.rgb, u.night);
  } else if (kind == 3u) {
    // Twinkle in three steps rather than smoothly, in keeping with the pixel art.
    // Dim stars fade towards the sky behind them.
    let level = floor((sin(u.time * ${(2 * Math.PI * TWINKLES_PER_CYCLE / SKY_CYCLE_SECONDS).toFixed(6)} + b.w) * 0.5 + 0.5) * 2.999) / 2.0;
    let sky = mix(u.top.rgb, u.bottom.rgb, clamp(px.y / max(u.horizon, 1.0), 0.0, 1.0));
    rgb = mix(sky, rgb, 0.4 + 0.6 * level);
  }
  out.color = vec4f(rgb, 1.0);
  return out;
}

@fragment fn blockFragment(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`

function rgba(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255).concat(1)
}

const FLOATS_PER_INSTANCE = 12

function instances(scene: LandscapeScene): Float32Array<ArrayBuffer> {
  const data: number[] = []
  const add = (originX: number, r: Rect, y: number, speed: number, kind: Kind, phase = 0) =>
    data.push(originX, r.x, y, r.width, r.height, speed, kind, phase, ...rgba(r.fill))
  const still = (r: Rect, kind: Kind, phase = 0) => add(r.x, { ...r, x: 0 }, r.y, 0, kind, phase)
  for (const r of scene.sun) still(r, Kind.Day)
  for (const r of scene.moon) still(r, Kind.Night)
  // A star's rects share a phase; their centre is the middle of their bounding box.
  const groups = new Map<number, Rect[]>()
  for (const star of scene.stars) groups.set(star.phase, [...(groups.get(star.phase) ?? []), star])
  for (const [phase, parts] of groups) {
    const left = Math.min(...parts.map((r) => r.x)), right = Math.max(...parts.map((r) => r.x + r.width))
    const top = Math.min(...parts.map((r) => r.y)), bottom = Math.max(...parts.map((r) => r.y + r.height))
    const cx = (left + right) / 2, cy = (top + bottom) / 2
    for (const r of parts) data.push(cx, r.x - cx, r.y, r.width, r.height, cy, Kind.Star, phase, ...rgba(r.fill))
  }
  for (const cloud of scene.clouds) for (const r of cloud.rects) add(cloud.x, r, cloud.y + r.y, cloud.speed, Kind.Cloud)
  return new Float32Array(data)
}

function isNight(): boolean {
  return document.documentElement.classList.contains('dark')
}

export interface SkyOptions {
  animate: boolean
  // Called if the GPU device is lost after the sky started; the caller shows the static sky again.
  onLost: () => void
}

interface Pipelines {
  layout: GPUBindGroupLayout
  sky: GPURenderPipeline
  blocks: GPURenderPipeline
}

// One device (and one set of pipelines) for every landscape on the page and across page navigations; a new one is
// requested only after a loss.
let shared: Promise<{ device: GPUDevice; pipelines: Pipelines } | null> | null = null

function sharedDevice(gpu: GPU): Promise<{ device: GPUDevice; pipelines: Pipelines } | null> {
  shared ??= (async () => {
    try {
      const adapter = await gpu.requestAdapter()
      if (!adapter) return null
      const device = await adapter.requestDevice()
      device.lost.then(() => { shared = null })
      // Validation errors (a shader or pipeline the browser rejects) do not throw: check for them here.
      device.pushErrorScope('validation')
      const pipelines = createPipelines(device, gpu.getPreferredCanvasFormat())
      const error = await device.popErrorScope()
      if (error) throw error
      return { device, pipelines }
    } catch (error) {
      console.warn('Skelril sky: WebGPU failed, keeping the static sky.', error)
      return null
    }
  })()
  return shared
}

function createPipelines(device: GPUDevice, format: GPUTextureFormat): Pipelines {
  const module = device.createShaderModule({ code: SHADER })
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const sky = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'skyVertex' },
    fragment: { module, entryPoint: 'skyFragment', targets: [{ format }] },
  })
  const blocks = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module, entryPoint: 'blockVertex',
      buffers: [{
        arrayStride: FLOATS_PER_INSTANCE * 4, stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x4' },
          { shaderLocation: 2, offset: 32, format: 'float32x4' },
        ],
      }],
    },
    fragment: { module, entryPoint: 'blockFragment', targets: [{ format }] },
  })
  return { layout, sky, blocks }
}

// Starts drawing the sky into the canvas. Resolves to a stop function once the first frame is drawn, or to null when
// WebGPU is unavailable or fails.
export async function startSky(canvas: HTMLCanvasElement, scene: LandscapeScene, options: SkyOptions):
    Promise<(() => void) | null> {
  const gpu = typeof navigator === 'undefined' ? undefined : navigator.gpu
  if (!gpu) return null
  const ready = await sharedDevice(gpu)
  if (!ready) return null
  const { device, pipelines: { layout, sky, blocks } } = ready
  const context = canvas.getContext('webgpu')
  if (!context) return null
  context.configure({ device, format: gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })
  device.pushErrorScope('validation')

  const data = instances(scene)
  const count = data.length / FLOATS_PER_INSTANCE
  const instanceBuffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(instanceBuffer, 0, data)
  const uniforms = new Float32Array(24)
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] })
  uniforms[7] = cloudSpan(scene.width)
  uniforms.set(rgba(NIGHT.clouds), 16)
  function setTimeOfDay() {
    const night = isNight()
    uniforms.set(rgba(night ? NIGHT.top : DAY.top), 8)
    uniforms.set(rgba(night ? NIGHT.horizon : DAY.horizon), 12)
    uniforms[20] = night ? 1 : 0
  }
  setTimeOfDay()

  // Seconds into the cycle, from the wall clock (in double precision here: the shader only gets the remainder).
  const frozen = Date.now()
  const cycleTime = () => ((options.animate ? Date.now() : frozen) / 1000) % SKY_CYCLE_SECONDS
  let stopped = false
  function draw() {
    if (stopped || canvas.width === 0 || canvas.height === 0) return
    const w = canvas.width, h = canvas.height
    const scale = Math.max(w / scene.width, h / scene.height)
    const offsetY = (h - scene.height * scale) / 2
    uniforms[0] = w
    uniforms[1] = h
    uniforms[2] = scale
    uniforms[3] = cycleTime()
    uniforms[4] = (w - scene.width * scale) / 2
    uniforms[5] = offsetY
    uniforms[6] = scene.groundTop * scale + offsetY
    uniforms[21] = STAR_CSS_PX * devicePixelRatio
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setBindGroup(0, bindGroup)
    pass.setPipeline(sky)
    pass.draw(3)
    pass.setPipeline(blocks)
    pass.setVertexBuffer(0, instanceBuffer)
    pass.draw(6, count)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  // Size the canvas in device pixels; redraw at once so a resize never shows a stretched frame.
  const maxSize = device.limits.maxTextureDimension2D
  function resize(width: number, height: number) {
    canvas.width = Math.max(1, Math.min(maxSize, Math.round(width)))
    canvas.height = Math.max(1, Math.min(maxSize, Math.round(height)))
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

  // Animate only while the sky is on screen (requestAnimationFrame already pauses in background tabs).
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

  device.lost.then(() => {
    if (stopped) return
    stop()
    options.onLost()
  })

  function stop() {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    resizer.disconnect()
    watcher.disconnect()
    themeWatcher.disconnect()
    // The device is shared: release only this sky's buffers and canvas.
    instanceBuffer.destroy()
    uniformBuffer.destroy()
    context!.unconfigure()
  }
  try {
    const error = await device.popErrorScope()
    if (error) throw error
    await device.queue.onSubmittedWorkDone()
  } catch (error) {
    console.warn('Skelril sky: WebGPU failed, keeping the static sky.', error)
    stop()
    shared = null  // do not hand a failing device to the next landscape
    device.destroy()
    return null
  }
  return stopped ? null : stop
}
