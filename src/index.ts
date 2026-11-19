// Skelril's VitePress theme: the default theme with a pixel-art look. Each site's .vitepress/theme/index.ts exports it
// (or extends it with its own components).
import { h } from 'vue'
import type { Theme } from 'vitepress'
// Without fonts: the theme brings its own (Nunito, Silkscreen, VT323), so VitePress' Inter is not preloaded.
import DefaultTheme from 'vitepress/theme-without-fonts'
import '../css/skelril.css'
import CategoryIndex from './components/CategoryIndex.vue'
import DocFooterNote from './components/DocFooterNote.vue'
import Landscape from './components/Landscape.vue'
import PixelIcon from './components/PixelIcon.vue'

export { CategoryIndex, DocFooterNote, Landscape, PixelIcon }
export { ICON_NAMES } from './pixel.ts'
export type { CategoryCard, SkelrilThemeConfig } from './types.ts'

const SkelrilTheme: Theme = {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-after': () => h(DocFooterNote) }),
  enhanceApp({ app }) {
    app.component('CategoryIndex', CategoryIndex)
    app.component('PixelIcon', PixelIcon)
    app.component('Landscape', Landscape)
  },
}

export default SkelrilTheme
