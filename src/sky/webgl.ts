// The WebGL2 renderer. Positions are in device pixels from the top left (gl_FragCoord counts from the bottom, so the
// fragment shaders flip it). There is no base instance in WebGL2, so the trees are drawn by pointing the instance
// attributes further into the buffer.
import { FLOATS_PER_INSTANCE, GROUND, MOONLIGHT_ADD, MOONLIGHT_SCALE, U, vec3, type Instances, type Renderer } from './common.ts'

const c = vec3

const HEADER = `#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform Uniforms {
  vec2 size;
  float scale;
  float twinkle;
  vec2 origin;
  float horizon;
  float night;
  vec4 skyTop;
  vec4 skyBottom;
  vec4 cloudTint;
  vec2 offsets;
  vec2 spans;
  float seed;
  float groundTop;
  float sceneHeight;
};
vec3 moonlit(vec3 rgb) {
  return mix(rgb, rgb * vec3(${MOONLIGHT_SCALE}) + vec3(${MOONLIGHT_ADD}), night);
}
`

const FULLSCREEN = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));  // one triangle covering the canvas
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

const SKY = `${HEADER}
out vec4 colour;
void main() {
  float y = size.y - gl_FragCoord.y;
  colour = mix(skyTop, skyBottom, clamp(y / max(horizon, 1.0), 0.0, 1.0));
}
`

const GROUND_FRAGMENT = `${HEADER}
out vec4 colour;
// The same hash as pixel.ts (int to uint keeps the bit pattern), so the ground does not reshuffle when it widens.
float hash(int x, int y, uint s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + s * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec2 cell = floor((p - origin) / scale);
  int x = int(cell.x);
  int y = int(cell.y);
  int top = int(groundTop);
  if (y < top) discard;
  float roll = hash(x, y, uint(seed));
  vec3 rgb;
  if (y == top) rgb = ${c(GROUND.grass)};
  else if (y == top + 1) rgb = roll < ${GROUND.grassSpeckle} ? ${c(GROUND.grassDark)} : ${c(GROUND.grass)};
  else if (y < int(sceneHeight) - ${GROUND.stoneRows}) rgb = roll < ${GROUND.dirtSpeckle} ? ${c(GROUND.dirtDark)} : ${c(GROUND.dirt)};
  else rgb = roll < ${GROUND.stoneSpeckle} ? ${c(GROUND.stoneLight)} : ${c(GROUND.stone)};
  colour = vec4(moonlit(rgb), 1.0);
}
`

const BLOCK_VERTEX = `${HEADER}
layout(location = 0) in vec4 a;
layout(location = 1) in vec4 b;
layout(location = 2) in vec4 tint;
flat out vec4 blockColour;
void main() {
  int layer = int(b.x);
  int kind = int(b.y);
  bool isNight = night > 0.5;
  if ((kind == 1 && isNight) || ((kind == 2 || kind == 3) && !isNight)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);  // not this time of day: outside the clip volume
    blockColour = vec4(0.0);
    return;
  }
  float x = a.x;
  if (layer > 0) {
    float span = spans[layer - 1];
    float shifted = a.x + span * 0.5 + offsets[layer - 1];
    x = shifted - span * floor(shifted / span) - span * 0.5 + b.w;
  }
  int i = gl_VertexID;
  vec2 corner = vec2(float(i == 1 || i == 2 || i == 4), float(i >= 2 && i != 3));
  vec2 scene = vec2(x, a.y) + corner * a.zw;
  // Snap edges to device pixels so the blocks stay crisp while they move.
  vec2 px = floor(scene * scale + origin + 0.5);
  gl_Position = vec4(px.x / size.x * 2.0 - 1.0, 1.0 - px.y / size.y * 2.0, 0.0, 1.0);
  vec3 rgb = tint.rgb;
  if (kind == 0) {
    rgb *= mix(vec3(1.0), cloudTint.rgb, night);
  } else if (kind == 3) {
    float level = floor((sin(twinkle + b.z) * 0.5 + 0.5) * 2.999) / 2.0;
    vec3 sky = mix(skyTop.rgb, skyBottom.rgb, clamp(px.y / max(horizon, 1.0), 0.0, 1.0));
    rgb = mix(sky, rgb, 0.4 + 0.6 * level);
  } else if (kind == 4) {
    rgb = moonlit(rgb);
  }
  blockColour = vec4(rgb, 1.0);
}
`

const BLOCK_FRAGMENT = `${HEADER}
flat in vec4 blockColour;
out vec4 colour;
void main() {
  colour = blockColour;
}
`

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const p = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed')
    gl.attachShader(p, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed')
  const block = gl.getUniformBlockIndex(p, 'Uniforms')
  if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, 0)
  return p
}

// A WebGL2 renderer for the canvas, or null without WebGL2.
export function webglRenderer(canvas: HTMLCanvasElement, onLost: () => void): Renderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power',
  })
  if (!gl) return null
  let programs: { sky: WebGLProgram; ground: WebGLProgram; blocks: WebGLProgram }
  try {
    programs = {
      sky: program(gl, FULLSCREEN, SKY),
      ground: program(gl, FULLSCREEN, GROUND_FRAGMENT),
      blocks: program(gl, BLOCK_VERTEX, BLOCK_FRAGMENT),
    }
  } catch (error) {
    console.warn('Skelril landscape: WebGL2 failed.', error)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  const uniformBuffer = gl.createBuffer()
  gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer)
  gl.bufferData(gl.UNIFORM_BUFFER, U.count * 4, gl.DYNAMIC_DRAW)
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, uniformBuffer)
  const instanceBuffer = gl.createBuffer()
  const empty = gl.createVertexArray()  // the fullscreen passes have no attributes
  const blocksVao = gl.createVertexArray()
  gl.bindVertexArray(blocksVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
  for (let location = 0; location < 3; location += 1) {
    gl.enableVertexAttribArray(location)
    gl.vertexAttribDivisor(location, 1)
  }
  const stride = FLOATS_PER_INSTANCE * 4
  function pointAt(first: number) {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, instanceBuffer)  // vertexAttribPointer reads the bound buffer
    for (let location = 0; location < 3; location += 1) {
      gl!.vertexAttribPointer(location, 4, gl!.FLOAT, false, stride, first * stride + location * 16)
    }
  }
  gl.bindVertexArray(null)
  let back = 0, trees = 0

  const lost = (event: Event) => {
    event.preventDefault()
    onLost()
  }
  canvas.addEventListener('webglcontextlost', lost)

  return {
    maxSize: Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    setInstances(built: Instances) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW)
      back = built.back
      trees = built.trees
    },
    draw(uniforms) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer)
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms)
      gl.bindVertexArray(empty)
      gl.useProgram(programs.sky)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(blocksVao)
      gl.useProgram(programs.blocks)
      pointAt(0)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, back)
      gl.bindVertexArray(empty)
      gl.useProgram(programs.ground)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(blocksVao)
      gl.useProgram(programs.blocks)
      pointAt(back)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, trees)
      gl.bindVertexArray(null)
    },
    ready() {
      const error = gl.getError()
      if (error === gl.NO_ERROR && !gl.isContextLost()) return true
      console.warn('Skelril landscape: WebGL2 failed, error', error)
      return false
    },
    destroy() {
      canvas.removeEventListener('webglcontextlost', lost)
      // Free the context now rather than at garbage collection: browsers cap how many can be alive.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
