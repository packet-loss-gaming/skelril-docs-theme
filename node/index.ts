// Build-time helpers shared by the Skelril sites' VitePress configs: the chapter scanner (URL rewrites and sidebar) and the
// markdown plugins (command chips, chapter banners, callout icons).
import fs from 'node:fs'
import path from 'node:path'
import type { DefaultTheme, MarkdownRenderer } from 'vitepress'
import { iconSvg } from '../src/pixel.ts'

export { ICON_NAMES } from '../src/pixel.ts'
import type { CategoryCard, SkelrilThemeConfig } from '../src/types.ts'

export type { CategoryCard, SkelrilThemeConfig }

// Chapter files and directories are named NN-name or NNx-name (e.g. 05c-item-sorters.md, inserted after 05-locks.md).
// The prefix orders the sidebar and is dropped from the URL: /guide/item-sorters. A letter counts as a fraction.
export function parseNumberPrefix(name: string): { name: string; order: number | undefined } {
  const match = /^(\d+)([a-z])?-(.+)$/.exec(name)
  if (!match) return { name, order: undefined }
  const fraction = match[2] ? (match[2].charCodeAt(0) - 96) / 100 : 0
  return { name: match[3], order: Number(match[1]) + fraction }
}

interface Page {
  frontmatter: Record<string, string>
  title: string
  description: string
}

// Front matter here is flat `key: value` text; that is all the chapters use.
function readPage(file: string): Page {
  const text = fs.readFileSync(file, 'utf8')
  const frontmatter: Record<string, string> = {}
  let body = text
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (fm) {
    body = text.slice(fm[0].length)
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
      if (kv) frontmatter[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  const h1 = /^# (.+)$/m.exec(body)
  // The first prose paragraph after the title, as plain text: the card text on category pages.
  const paragraph = body
    .replace(/^# .+$/m, '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(:::|\||#|<|```|[-*+] |\d+\. |>)/.test(p)) ?? ''
  const description = frontmatter.description ?? plainText(paragraph)
  const title = frontmatter.sidebar_label ?? frontmatter.title ?? (h1 ? h1[1].trim() : path.basename(file, '.md'))
  return { frontmatter, title, description }
}

function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface Chapters {
  // Source path (relative to srcDir) -> served path, for VitePress `rewrites`.
  rewrites: Record<string, string>
  sidebar: DefaultTheme.SidebarItem[]
  // Served page path (e.g. guide/areas.md) -> the cards its <CategoryIndex /> shows.
  categories: Record<string, CategoryCard[]>
}

interface Entry {
  order: number
  name: string
  item: DefaultTheme.SidebarItem
  card: CategoryCard
}

// Walks `<srcDir>/<dir>` and serves every chapter under `routeBase` with its number prefixes removed, the way the
// Docusaurus sites did. A directory's index.md is the category page (its URL is the directory's, e.g. /guide/areas).
// Front matter `slug: /` serves a chapter at the site root.
export function scanChapters(srcDir: string, dir: string, routeBase: string): Chapters {
  const rewrites: Record<string, string> = {}
  const categories: Record<string, CategoryCard[]> = {}
  const served = new Map<string, string>()

  function serve(source: string, target: string): void {
    const previous = served.get(target)
    if (previous) throw new Error(`${source} and ${previous} would both be served as /${target}`)
    served.set(target, source)
    rewrites[source] = target
  }

  function walk(rel: string, route: string[]): Entry[] {
    const entries: Entry[] = []
    const abs = path.join(srcDir, rel)
    for (const dirent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (dirent.name.startsWith('_') || dirent.name.startsWith('.')) continue
      const source = path.posix.join(rel, dirent.name)
      if (dirent.isDirectory()) {
        const { name, order } = parseNumberPrefix(dirent.name)
        const childRoute = [...route, name]
        const children = walk(source, childRoute)
        const indexFile = path.join(abs, dirent.name, 'index.md')
        const link = '/' + childRoute.join('/')
        const page = fs.existsSync(indexFile) ? readPage(indexFile) : undefined
        if (page) {
          const target = childRoute.join('/') + '.md'
          serve(path.posix.join(source, 'index.md'), target)
          categories[target] = children.map((c) => c.card)
        }
        const text = page?.title ?? name
        entries.push({
          order: order ?? Infinity,
          name,
          item: { text, link: page ? link : undefined, collapsed: true, items: children.map((c) => c.item) },
          card: { text, link, description: page?.description ?? '' },
        })
      } else if (dirent.name.endsWith('.md') && dirent.name !== 'index.md') {
        const { name, order } = parseNumberPrefix(dirent.name.slice(0, -3))
        const page = readPage(path.join(abs, dirent.name))
        const slug = page.frontmatter.slug
        let target: string
        if (slug === '/') target = 'index.md'
        else if (slug) target = slug.replace(/^\//, '') + '.md'
        else target = [...route, name].join('/') + '.md'
        serve(source, target)
        const link = target === 'index.md' ? '/' : '/' + target.slice(0, -3)
        entries.push({
          order: order ?? Infinity,
          name,
          item: { text: page.title, link },
          card: { text: page.title, link, description: page.description },
        })
      }
    }
    entries.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    return entries
  }

  const base = routeBase ? routeBase.split('/').filter(Boolean) : []
  const sidebar = walk(dir, base).map((e) => e.item)
  return { rewrites, sidebar, categories }
}

// Inline code that starts with "/" is a chat command: give it the "cmd" chip style. Fenced code is a separate token type
// and keeps its own styling.
export function cmdChips(md: MarkdownRenderer): void {
  const original = md.renderer.rules.code_inline!
  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token.content.startsWith('/')) token.attrJoin('class', 'cmd')
    return original(tokens, idx, options, env, self)
  }
}

// A chapter's first H1 is a dirt banner led by its pixel icon (front matter `icon:`).
export function chapterBanner(md: MarkdownRenderer): void {
  const original = md.renderer.rules.heading_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const icon: unknown = env?.frontmatter?.icon
    if (token.tag !== 'h1' || typeof icon !== 'string' || env.skelrilBannerDone) return original(tokens, idx, options, env, self)
    env.skelrilBannerDone = true
    token.attrJoin('class', 'chapter-title')
    return original(tokens, idx, options, env, self) + iconSvg(icon, 3)
  }
}

// Callouts (::: tip / info / warning / danger) lead their title with a pixel icon.
export const ADMONITION_ICONS: Record<string, string> = { tip: 'torch', info: 'sign', warning: 'tnt', danger: 'tnt' }

export function admonitionIcons(md: MarkdownRenderer): void {
  for (const [kind, icon] of Object.entries(ADMONITION_ICONS)) {
    const rule = `container_${kind}_open`
    const original = md.renderer.rules[rule]
    if (!original) throw new Error(`VitePress no longer registers the "${kind}" container (rule ${rule})`)
    md.renderer.rules[rule] = (tokens, idx, options, env, self) =>
      original(tokens, idx, options, env, self).replace('<p class="custom-block-title">',
        `<p class="custom-block-title">${iconSvg(icon, 2, 'pixel-icon admonition-icon')}`)
  }
}

// Each site passes this as `markdown.config`.
export function skelrilMarkdown(md: MarkdownRenderer): void {
  cmdChips(md)
  chapterBanner(md)
  admonitionIcons(md)
}

