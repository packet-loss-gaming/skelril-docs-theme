import type { DefaultTheme } from 'vitepress'

export interface CategoryCard {
  text: string
  link: string
  description: string
}

// The default theme's config plus the category cards computed by the chapter scanner.
export interface SkelrilThemeConfig extends DefaultTheme.Config {
  categories?: Record<string, CategoryCard[]>
}
