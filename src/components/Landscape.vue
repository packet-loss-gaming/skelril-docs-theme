<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { cloudRects, groundRects, landscapeScene, MOONLIGHT } from '../pixel'

// width: scene pixels across in the static (SVG) fallback; the WebGPU scene is as wide as the screen.
const props = withDefaults(defineProps<{ width?: number; height?: number; groundTop?: number; seed?: number }>(),
  { width: 320, height: 88, groundTop: 60, seed: 7 })
const scene = computed(() => landscapeScene(props))
const clouds = computed(() => scene.value.clouds.map((c) => ({ far: c.layer === 'far', rects: cloudRects(c) })))
// The SVG's ground repeats one tile of the (hashed) WebGPU ground, so its size does not grow with the width.
const GROUND_TILE = 64
const groundTile = computed(() => groundRects(scene.value, 0, GROUND_TILE).map((r) => ({ ...r, y: r.y - props.groundTop })))
// Dark mode (VitePress' html.dark) shows the night layers and dims the foreground with this filter (see skelril.css).
const id = useId()
const moonlight = `skelril-moonlight-${id}`
const groundPattern = `skelril-ground-${id}`
const [r, g, b] = MOONLIGHT.scale, [ar, ag, ab] = MOONLIGHT.add
const moonlightMatrix = `${r} 0 0 0 ${ar}  0 ${g} 0 0 ${ag}  0 0 ${b} 0 ${ab}  0 0 0 1 0`

// With WebGPU the canvas draws the whole scene, sized to the screen; the SVG is only the fallback, without WebGPU or
// after it fails. skelrilHead marks capable browsers (html.skelril-webgpu) before the page renders, so they never see
// the SVG; until the first frame the canvas shows a CSS gradient. Reduced motion stops the movement.
const canvas = ref<HTMLCanvasElement>()
const live = ref(false)
const fallback = ref(false)
let stop: (() => void) | null = null
let unmounted = false

onMounted(async () => {
  if (!canvas.value || !('gpu' in navigator)) {
    fallback.value = true
    return
  }
  const { startSky } = await import('../sky')
  const lost = () => {
    live.value = false
    fallback.value = true
  }
  const stopSky = await startSky(canvas.value, {
    height: props.height, groundTop: props.groundTop, seed: props.seed,
    animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, onLost: lost,
  })
  if (unmounted) stopSky?.()
  else if (stopSky) {
    stop = stopSky
    live.value = true
  } else fallback.value = true
})
onBeforeUnmount(() => {
  unmounted = true
  stop?.()
})
</script>

<template>
  <div class="landscape" :class="{ 'landscape-live': live, 'landscape-static': fallback }"
    :style="{ '--landscape-moonlight': `url(#${moonlight})`, '--landscape-rows': height, '--landscape-ground-rows': height - groundTop }">
    <canvas ref="canvas" aria-hidden="true" />
    <svg xmlns="http://www.w3.org/2000/svg" :viewBox="`${-width / 2} 0 ${width} ${height}`" preserveAspectRatio="xMidYMax slice"
      shape-rendering="crispEdges" aria-hidden="true">
      <filter :id="moonlight" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" :values="moonlightMatrix" />
      </filter>
      <g class="landscape-day">
        <rect v-for="(r, i) in [...scene.daySky, ...scene.sun]" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
      </g>
      <g class="landscape-night">
        <rect v-for="(r, i) in [...scene.nightSky, ...scene.moon, ...scene.stars]" :key="i" :x="r.x" :y="r.y" :width="r.width"
          :height="r.height" :fill="r.fill" />
      </g>
      <g v-for="(cloud, c) in clouds" :key="c" :class="cloud.far ? 'landscape-cloud landscape-cloud-far' : 'landscape-cloud'">
        <rect v-for="(r, i) in cloud.rects" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
      </g>
      <pattern :id="groundPattern" patternUnits="userSpaceOnUse" x="0" :y="groundTop" :width="GROUND_TILE" :height="height - groundTop">
        <rect v-for="(r, i) in groundTile" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
      </pattern>
      <g class="landscape-ground">
        <rect v-for="(r, i) in scene.trees" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
        <rect :x="-width / 2" :y="groundTop" :width="width" :height="height - groundTop" :fill="`url(#${groundPattern})`" />
      </g>
    </svg>
  </div>
</template>
