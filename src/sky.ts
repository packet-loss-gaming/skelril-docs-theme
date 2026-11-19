/// <reference types="@webgpu/types" />
// The landscape as a WebGPU scene, sized to the canvas: blocks are a whole number of device pixels (fitted to the
// canvas height, rounded down, ground at the bottom) and the scene is as many scene pixels wide as fit, so wider screens get more
// trees, clouds and stars rather than a zoomed-in picture. By day: a gradient sky, the sun and drifting block clouds.
// By night (dark mode: VitePress' html.dark class): the moon, twinkling block stars, slate clouds and a moonlit
// foreground. Clouds drift on wall-clock time, so every page (and every reload) shows the same sky.
import { GROUND, landscapeScene, MOONLIGHT, type LandscapeScene, type Rect } from './pixel.ts'

const DAY = { top: '#4f9de6', horizon: '#bfe4ff' }
const NIGHT = { top: '#070b24', horizon: '#26346a', clouds: '#5c6a90' }  // clouds: multiplies their daytime colour
const TWINKLE_RATE = 1.3  // radians per second

// What an instance is: clouds are always drawn (tinted at night); the others belong to one time of day or are
// foreground (moonlit at night).
const Kind = { Cloud: 0, Day: 1, Night: 2, Star: 3, Tree: 4 } as const
type Kind = typeof Kind[keyof typeof Kind]
const Layer = { None: 0, Far: 1, Near: 2 } as const

function rgba(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255).concat(1)
}
const vec3 = (hex: string) => `vec3f(${rgba(hex).slice(0, 3).map((c) => c.toFixed(5)).join(', ')})`

const SHADER = /* wgsl */ `
struct Uniforms {
  size: vec2f,        // canvas size, device pixels
  scale: f32,         // device pixels per scene pixel (whole)
  twinkle: f32,       // radians
  origin: vec2f,      // scene (0, 0), device pixels: the middle of the top edge of the scene
  horizon: f32,       // ground line, device pixels from the top
  night: f32,         // 0 by day, 1 by night
  top: vec4f,
  bottom: vec4f,
  cloudTint: vec4f,
  offsets: vec2f,     // drift of the far and near cloud layers, scene pixels
  spans: vec2f,       // width of the strip each layer wraps around, scene pixels
  seed: f32,
  groundTop: f32,
  sceneHeight: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

fn moonlit(rgb: vec3f) -> vec3f {
  return mix(rgb, rgb * vec3f(${MOONLIGHT.scale.join(', ')}) + vec3f(${MOONLIGHT.add.join(', ')}), u.night);
}

@vertex fn fullscreen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));  // one triangle covering the canvas
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn skyFragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return mix(u.top, u.bottom, clamp(p.y / max(u.horizon, 1.0), 0.0, 1.0));
}

// The same hash as pixel.ts, so the ground matches the SVG version.
fn hash(x: i32, y: i32, seed: u32) -> f32 {
  var h = bitcast<u32>(x) * 374761393u + bitcast<u32>(y) * 668265263u + seed * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

@fragment fn groundFragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let cell = floor((p.xy - u.origin) / u.scale);
  let x = i32(cell.x);
  let y = i32(cell.y);
  let top = i32(u.groundTop);
  if (y < top) {
    discard;
  }
  let roll = hash(x, y, u32(u.seed));
  var rgb: vec3f;
  if (y == top) {
    rgb = ${vec3(GROUND.grass)};
  } else if (y == top + 1) {
    rgb = select(${vec3(GROUND.grass)}, ${vec3(GROUND.grassDark)}, roll < ${GROUND.grassSpeckle});
  } else if (y < i32(u.sceneHeight) - ${GROUND.stoneRows}) {
    rgb = select(${vec3(GROUND.dirt)}, ${vec3(GROUND.dirtDark)}, roll < ${GROUND.dirtSpeckle});
  } else {
    rgb = select(${vec3(GROUND.stone)}, ${vec3(GROUND.stoneLight)}, roll < ${GROUND.stoneSpeckle});
  }
  return vec4f(moonlit(rgb), 1.0);
}

struct Block {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

// One instance per rect: a = (x, y, width, height), b = (layer, kind, twinkle phase, x within the cloud). A cloud's
// rects share its x and drift with its layer, wrapping around the layer's strip.
@vertex fn blockVertex(@builtin(vertex_index) i: u32, @location(0) a: vec4f, @location(1) b: vec4f,
                       @location(2) color: vec4f) -> Block {
  var out: Block;
  let layer = u32(b.x);
  let kind = u32(b.y);
  let night = u.night > 0.5;
  if ((kind == 1u && night) || ((kind == 2u || kind == 3u) && !night)) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);  // not this time of day: outside the clip volume
    return out;
  }
  var x = a.x;
  if (layer > 0u) {
    let span = u.spans[layer - 1u];
    let shifted = a.x + span * 0.5 + u.offsets[layer - 1u];
    x = shifted - span * floor(shifted / span) - span * 0.5 + b.w;
  }
  let corner = vec2f(f32(i == 1u || i == 2u || i == 4u), f32(i >= 2u && i != 3u));
  let scene = vec2f(x, a.y) + corner * a.zw;
  // Snap edges to device pixels so the blocks stay crisp while they move.
  let px = round(scene * u.scale + u.origin);
  out.position = vec4f(px.x / u.size.x * 2.0 - 1.0, 1.0 - px.y / u.size.y * 2.0, 0.0, 1.0);
  var rgb = color.rgb;
  if (kind == 0u) {
    rgb *= mix(vec3f(1.0), u.cloudTint.rgb, u.night);
  } else if (kind == 3u) {
    // Twinkle in three steps rather than smoothly, in keeping with the pixel art; dim stars fade into the sky.
    let level = floor((sin(u.twinkle + b.z) * 0.5 + 0.5) * 2.999) / 2.0;
    let sky = mix(u.top.rgb, u.bottom.rgb, clamp(px.y / max(u.horizon, 1.0), 0.0, 1.0));
    rgb = mix(sky, rgb, 0.4 + 0.6 * level);
  } else if (kind == 4u) {
    rgb = moonlit(rgb);
  }
  out.color = vec4f(rgb, 1.0);
  return out;
}

@fragment fn blockFragment(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`

const FLOATS_PER_INSTANCE = 12

// The scene's blocks in draw order: everything behind the ground, then the trees in front of it.
function instances(scene: LandscapeScene): { data: Float32Array<ArrayBuffer>; back: number; trees: number } {
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

function isNight(): boolean {
  return document.documentElement.classList.contains('dark')
}

export interface SkyOptions {
  height: number       // scene pixels, ground included
  groundTop: number
  seed: number
  animate: boolean
  // Called if the GPU device is lost after the sky started; the caller shows the static scene again.
  onLost: () => void
}

interface Pipelines {
  layout: GPUBindGroupLayout
  sky: GPURenderPipeline
  ground: GPURenderPipeline
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
      console.warn('Skelril sky: WebGPU failed, keeping the static scene.', error)
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
  const fullscreen = (entryPoint: string) => device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint, targets: [{ format }] },
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
  return { layout, sky: fullscreen('skyFragment'), ground: fullscreen('groundFragment'), blocks }
}

// Starts drawing the landscape into the canvas. Resolves to a stop function once the first frame is drawn, or to null
// when WebGPU is unavailable or fails.
export async function startSky(canvas: HTMLCanvasElement, options: SkyOptions): Promise<(() => void) | null> {
  const gpu = typeof navigator === 'undefined' ? undefined : navigator.gpu
  if (!gpu) return null
  const ready = await sharedDevice(gpu)
  if (!ready) return null
  const { device, pipelines } = ready
  const context = canvas.getContext('webgpu')
  if (!context) return null
  context.configure({ device, format: gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })
  device.pushErrorScope('validation')

  const uniforms = new Float32Array(28)
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bindGroup = device.createBindGroup({ layout: pipelines.layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] })
  uniforms.set(rgba(NIGHT.clouds), 16)
  uniforms[24] = options.seed
  uniforms[25] = options.groundTop
  uniforms[26] = options.height
  function setTimeOfDay() {
    const night = isNight()
    uniforms.set(rgba(night ? NIGHT.top : DAY.top), 8)
    uniforms.set(rgba(night ? NIGHT.horizon : DAY.horizon), 12)
    uniforms[7] = night ? 1 : 0
  }
  setTimeOfDay()

  // The scene for the current width, rebuilt when the canvas gets wider or narrower in scene pixels.
  let scene: LandscapeScene | null = null
  let instanceBuffer: GPUBuffer | null = null
  let back = 0, trees = 0
  function layout(sceneWidth: number): LandscapeScene {
    if (scene?.width === sceneWidth) return scene
    scene = landscapeScene({ width: sceneWidth, height: options.height, groundTop: options.groundTop, seed: options.seed })
    const built = instances(scene)
    if (!instanceBuffer || instanceBuffer.size < built.data.byteLength) {
      instanceBuffer?.destroy()
      instanceBuffer = device.createBuffer({ size: built.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    }
    device.queue.writeBuffer(instanceBuffer, 0, built.data)
    back = built.back
    trees = built.trees
    uniforms[22] = scene.layers.far.span
    uniforms[23] = scene.layers.near.span
    return scene
  }

  // Wall-clock seconds, in double precision here: the shader only gets each layer's offset and the twinkle angle.
  const frozen = Date.now()
  let stopped = false
  function draw() {
    if (stopped || canvas.width === 0 || canvas.height === 0) return
    const w = canvas.width, h = canvas.height
    const scale = Math.max(1, Math.floor(h / options.height))  // whole device pixels; spare height is more sky
    const current = layout(Math.ceil(w / scale / 2) * 2 + 2)  // even, and a pixel spare at each side
    const now = (options.animate ? Date.now() : frozen) / 1000
    uniforms[0] = w
    uniforms[1] = h
    uniforms[2] = scale
    uniforms[3] = (now * TWINKLE_RATE) % (Math.PI * 2)
    uniforms[4] = Math.round(w / 2)
    uniforms[5] = h - options.height * scale
    uniforms[6] = uniforms[5] + options.groundTop * scale
    uniforms[20] = (now * current.layers.far.speed) % current.layers.far.span
    uniforms[21] = (now * current.layers.near.speed) % current.layers.near.span
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setBindGroup(0, bindGroup)
    pass.setPipeline(pipelines.sky)
    pass.draw(3)
    pass.setPipeline(pipelines.blocks)
    pass.setVertexBuffer(0, instanceBuffer!)
    pass.draw(6, back)
    pass.setPipeline(pipelines.ground)
    pass.draw(3)
    pass.setPipeline(pipelines.blocks)
    pass.draw(6, trees, 0, back)
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

  // Animate only while the scene is on screen (requestAnimationFrame already pauses in background tabs).
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
    // The device is shared: release only this landscape's buffers and canvas.
    instanceBuffer?.destroy()
    uniformBuffer.destroy()
    context!.unconfigure()
  }
  try {
    const error = await device.popErrorScope()
    if (error) throw error
    await device.queue.onSubmittedWorkDone()
  } catch (error) {
    console.warn('Skelril sky: WebGPU failed, keeping the static scene.', error)
    stop()
    shared = null  // do not hand a failing device to the next landscape
    device.destroy()
    return null
  }
  return stopped ? null : stop
}
