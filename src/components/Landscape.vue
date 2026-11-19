<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// The pixel-art landscape, drawn with WebGL2 (src/sky/). Until the first frame, and in browsers without WebGL2, the
// canvas shows its CSS background: the sky and the ground bands as a gradient (see skelril.css).
const props = withDefaults(defineProps<{ height?: number; groundTop?: number; seed?: number }>(),
  { height: 88, groundTop: 60, seed: 7 })

const canvas = ref<HTMLCanvasElement>()
let stop: (() => void) | null = null
let unmounted = false

async function start(retries: number) {
  if (!canvas.value) return
  const { startSky } = await import('../sky')
  const stopSky = startSky(canvas.value, {
    height: props.height, groundTop: props.groundTop, seed: props.seed,
    animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    // A lost context (a GPU reset, say): start again, a few times at most.
    onLost: () => {
      stop = null
      if (retries > 0 && !unmounted) setTimeout(() => start(retries - 1), 1000)
    },
  })
  if (unmounted) stopSky?.()
  else stop = stopSky
}

onMounted(() => start(2))
onBeforeUnmount(() => {
  unmounted = true
  stop?.()
})
</script>

<template>
  <div class="landscape" :style="{ '--landscape-rows': height, '--landscape-ground-rows': height - groundTop }">
    <canvas ref="canvas" aria-hidden="true" />
  </div>
</template>
