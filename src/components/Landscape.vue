<script setup lang="ts">
import { computed } from 'vue'
import { landscapeRects } from '../pixel'

const props = withDefaults(defineProps<{ width?: number; height?: number; groundTop?: number; seed?: number }>(),
  { width: 68, height: 88, groundTop: 60, seed: 7 })
const rects = computed(() => landscapeRects(props))
</script>

<template>
  <svg class="landscape" xmlns="http://www.w3.org/2000/svg" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="xMidYMid slice"
    shape-rendering="crispEdges" aria-hidden="true">
    <rect v-for="(r, i) in rects" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
  </svg>
</template>
