<script setup lang="ts">
// The default theme hides its footer next to the sidebar; doc pages repeat the copyright line after the pager.
import { useData } from 'vitepress'
import type { SkelrilThemeConfig } from '../types'

const { theme } = useData<SkelrilThemeConfig>()
</script>

<template>
  <p v-if="theme.footer?.copyright" class="doc-footer-note">{{ theme.footer.copyright }}</p>
</template>
