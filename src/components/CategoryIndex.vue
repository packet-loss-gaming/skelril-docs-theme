<script setup lang="ts">
// The cards of a category page (a directory's index.md): one per chapter in the directory, the replacement for
// Docusaurus' generated-index pages. The chapter scanner computes them (themeConfig.categories).
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import type { SkelrilThemeConfig } from '../types'

const { page, theme } = useData<SkelrilThemeConfig>()
const cards = computed(() => theme.value.categories?.[page.value.relativePath] ?? [])
</script>

<template>
  <div class="category-index">
    <a v-for="card in cards" :key="card.link" class="category-card" :href="withBase(card.link)">
      <strong>{{ card.text }}</strong>
      <span v-if="card.description">{{ card.description }}</span>
    </a>
  </div>
</template>
