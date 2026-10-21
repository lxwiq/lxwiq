/**
 * Shared by every generated panel: the embedded monospace face, the ASCII
 * snowfall and the black frame. Panels are black in both GitHub themes, so
 * each one is a single file.
 *
 * IBM Plex Mono is inlined as a data URI: GitHub serves README images
 * standalone, so an SVG cannot load anything from outside itself.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

const MONO = (await readFile(join(ASSETS, 'fonts', 'ibm-plex-mono.woff2'))).toString('base64')
const MONO_STACK = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

/** Plex Mono advances exactly 0.6em per character. */
export const ADVANCE = 0.6

/** Dark to bright; scripts/ascii-portrait.mjs picks from it, the banner reads it back. */
export const RAMP = ' .:-=+*#%@'

export const INK = {
  bright: '#ececec',
  text: '#c8c8c8',
  muted: '#8a8a8a',
  faint: '#666666',
}

// mulberry32 — tiny, seedable, good enough for scattering snow.
export function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const between = (rand, a, b) => a + rand() * (b - a)

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

/**
 * Three depths of falling ASCII flakes, scaled to the panel's area. Each layer
 * is drawn twice, stacked, so the fall loops seamlessly.
 */
function snowfall(seed, w, h, density) {
  const rand = prng(seed)
  const area = ((w * h) / (1200 * 320)) * density
  const depths = [
    { count: 80, glyphs: '..·', size: 10, opacity: [0.2, 0.45], fall: 52, sway: 8 },
    { count: 30, glyphs: '**·', size: 12, opacity: [0.3, 0.6], fall: 34, sway: 10 },
    { count: 7, glyphs: '*', size: 16, opacity: [0.4, 0.7], fall: 21, sway: 14 },
  ]
  return depths
    .map((d) => {
      let flakes = ''
      for (let i = 0, n = Math.round(d.count * area); i < n; i++) {
        const glyph = d.glyphs[Math.floor(rand() * d.glyphs.length)]
        flakes += `<text x="${Math.round(between(rand, 0, w))}" y="${Math.round(between(rand, 0, h))}" fill-opacity="${between(rand, ...d.opacity).toFixed(2)}">${glyph}</text>`
      }
      return `
    <g class="sway" font-size="${d.size}" style="--sway: ${d.sway}px; animation-duration: ${(d.fall / 4).toFixed(1)}s">
      <g class="fall" style="animation-duration: ${d.fall}s">
        <g>${flakes}</g>
        <g transform="translate(0 -${h})">${flakes}</g>
      </g>
    </g>`
    })
    .join('')
}

/** A black, hairline-framed panel with snow falling behind `body`. */
export function panel({ w, h, label, seed, body, density = 1 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${MONO_STACK}">
  <style>
    @font-face { font-family: 'IBM Plex Mono'; src: url(data:font/woff2;base64,${MONO}) format('woff2'); }
    text { white-space: pre; }
    .fall { animation: fall linear infinite; }
    .sway { animation: sway ease-in-out infinite alternate; }
    @keyframes fall { from { transform: translateY(0); } to { transform: translateY(${h}px); } }
    @keyframes sway { from { transform: translateX(calc(var(--sway) * -1)); } to { transform: translateX(var(--sway)); } }
    @media (prefers-reduced-motion: reduce) { .fall, .sway { animation: none; } }
  </style>
  <clipPath id="frame"><rect width="${w}" height="${h}" rx="12"/></clipPath>
  <g clip-path="url(#frame)">
    <rect width="${w}" height="${h}" fill="#000"/>
    <g fill="#fff">${snowfall(seed, w, h, density)}
    </g>
${body}
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="none" stroke="#1f1f1f"/>
  </g>
</svg>
`
}
