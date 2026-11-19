<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { cloudRects, landscapeScene } from '../pixel'

const props = withDefaults(defineProps<{ width?: number; height?: number; groundTop?: number; seed?: number }>(),
  { width: 68, height: 88, groundTop: 60, seed: 7 })
const scene = computed(() => landscapeScene(props))
const clouds = computed(() => scene.value.clouds.filter((c) => c.x < scene.value.width).map((c) => ({ far: c.far, rects: cloudRects(c) })))
// Dark mode (VitePress' html.dark) shows the night layers and dims the foreground with this filter (see skelril.css).
const moonlight = `skelril-moonlight-${useId()}`

// With WebGPU, the canvas behind the SVG draws the sky (gradient, drifting clouds, twinkling stars) and the SVG keeps
// only the foreground; the static SVG sky is shown only without WebGPU or after it fails. skelrilHead marks capable
// browsers (html.skelril-webgpu) before the page renders, so they never see the SVG sky; the canvas shows a CSS
// gradient until its first frame. Reduced motion stops the movement.
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
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches
  const lost = () => {
    live.value = false
    fallback.value = true
  }
  const stopSky = await startSky(canvas.value, scene.value, { animate, onLost: lost })
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
  <div class="landscape" :class="{ 'landscape-live': live, 'landscape-static': fallback }" :style="{ '--landscape-moonlight': `url(#${moonlight})` }">
    <canvas ref="canvas" class="landscape-sky" aria-hidden="true" />
    <svg xmlns="http://www.w3.org/2000/svg" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="xMidYMid slice"
      shape-rendering="crispEdges" aria-hidden="true">
      <filter :id="moonlight" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" values="0.42 0 0 0 0.02  0 0.48 0 0 0.03  0 0 0.66 0 0.09  0 0 0 1 0" />
      </filter>
      <g class="landscape-static-sky">
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
      </g>
      <g class="landscape-ground">
        <rect v-for="(r, i) in scene.ground" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
      </g>
    </svg>
  </div>
</template>
