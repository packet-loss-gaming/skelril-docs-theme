# vitepress-theme-skelril

Skelril's pixel-art VitePress theme, shared by Skelril's documentation sites, such as the public wiki
([skelril-docs](https://github.com/packet-loss-gaming/skelril-docs), wiki.skelril.net).

- `src/`: the client theme (`import theme from 'vitepress-theme-skelril'`), compiled by Vite.
- `node/`: build-time helpers for the site configs (`vitepress-theme-skelril/node`): the chapter scanner (URL
  rewrites, sidebar, category cards) and the markdown plugins (command chips, chapter banners, callout icons).
- `css/`, `fonts/`: styles and the bundled OFL fonts.

`<Landscape />` is the pixel-art hero scene, drawn with WebGL2 (`src/sky/`) and sized to the screen: blocks are a
whole number of device pixels fitted to the hero's height, and wider screens get more trees, clouds and stars. By day
block clouds drift across a gradient sky; in dark mode (VitePress' `html.dark`) there are the moon, twinkling block
stars and a moonlit foreground. Clouds drift on wall-clock time, so the scene lines up across page loads and
navigations. Until the first frame, and without WebGL2, the canvas shows the sky and ground as a CSS gradient;
`prefers-reduced-motion` stops the movement.

`src/` ships as TypeScript for Vite to compile. Node will not strip types under `node_modules`, so `node/` is bundled
to `dist/node.js` by the `prepare` script, which npm runs when it installs the git dependency. Sites need Node >= 22.18
and `vitepress` / `vue` as their own dependencies (peers).

## Using it

Sites pin a tag as an npm git dependency; their `package-lock.json` records the exact commit:

```json
"vitepress-theme-skelril": "git+https://github.com/packet-loss-gaming/skelril-docs-theme.git#v1.0.0"
```

Add `vite: { resolve: { dedupe: ['vue'] } }` to the site config so the theme and the site share one copy of Vue.

## Releasing

1. Commit the change here and tag it (`git tag v1.1.0 && git push origin main v1.1.0`). Bump the major version for
   changes that need site config or content changes.
2. In each site, update the `#vX.Y.Z` in `package.json`, run `npm install`, and commit `package.json` and
   `package-lock.json`.

## Working on the theme

To try uncommitted theme changes in a site, build `dist/` here (`npm install`, then `npm run build` after changes to
`node/`) and point the site at this checkout temporarily (do not commit it):

```sh
npm install --no-save <path to this checkout>      # e.g. ../skelril-docs-theme from skelril-docs
```

`npm ci` puts the pinned version back.
