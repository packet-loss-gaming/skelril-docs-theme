<script setup lang="ts">
import { computed } from 'vue'
import { iconShape } from '../pixel'

const props = withDefaults(defineProps<{ name: string; px?: number }>(), { px: 3 })
const shape = computed(() => iconShape(props.name))
</script>

<template>
  <svg class="pixel-icon" xmlns="http://www.w3.org/2000/svg" :viewBox="`0 0 ${shape.width} ${shape.height}`"
    :width="shape.width * px" :height="shape.height * px" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
    <rect v-for="(r, i) in shape.rects" :key="i" :x="r.x" :y="r.y" :width="r.width" :height="r.height" :fill="r.fill" />
  </svg>
</template>
