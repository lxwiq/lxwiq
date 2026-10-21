#!/usr/bin/env node
/**
 * Builds the profile banner: the handle on a black field of drifting
 * particles, scattered from a fixed seed so every run gives the same picture.
 * The banner is black in both GitHub themes, so there is a single file.
 *
 *   node scripts/generate-header.mjs
 *
 * The font is inlined as a data URI: GitHub serves README images standalone,
 * so the SVG cannot load anything from outside itself.
 *
 * Outputs assets/header.svg
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERIF = (await readFile(join(ROOT, 'assets', 'fonts', 'instrument-serif.woff2'))).toString('base64')

const W = 1200
const H = 320
const HANDLE = 'lxwiq'

const SERIF_STACK = "'Instrument Serif', 'Iowan Old Style', Georgia, serif"

/* --------------------------------------------------------------- particles */

// mulberry32 — tiny, seedable, good enough for scattering dust.
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (rand, a, b) => a + rand() * (b - a)
const r1 = (n) => Math.round(n * 10) / 10

/**
 * Three depths: fine dust far away, sharper motes in the middle, and a few
 * large out-of-focus specks up front. Each layer rises slowly and is drawn
 * twice, stacked, so the loop is seamless; some motes also flicker.
 */
function particles() {
  const rand = prng(42)
  const depths = [
    { count: 120, r: [0.6, 1.2], opacity: [0.2, 0.55], rise: 70, sway: 6, flicker: 0.3, fill: '#fff' },
    { count: 50, r: [1.2, 2], opacity: [0.4, 0.85], rise: 46, sway: 9, flicker: 0.4, fill: '#fff' },
    { count: 9, r: [7, 14], opacity: [0.08, 0.2], rise: 30, sway: 14, flicker: 0, fill: 'url(#bokeh)' },
  ]
  return depths.map((d) => {
    let motes = ''
    for (let i = 0; i < d.count; i++) {
      const attrs = `cx="${r1(between(rand, 0, W))}" cy="${r1(between(rand, 0, H))}" r="${r1(between(rand, ...d.r))}" fill-opacity="${between(rand, ...d.opacity).toFixed(2)}"`
      motes +=
        rand() < d.flicker
          ? `<circle ${attrs} class="flicker" style="animation-duration: ${between(rand, 2.5, 6).toFixed(1)}s; animation-delay: -${between(rand, 0, 6).toFixed(1)}s"/>`
          : `<circle ${attrs}/>`
    }
    return { ...d, motes }
  })
}

/* ------------------------------------------------------------------ banner */

const LAYERS = particles()

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${HANDLE}">
  <style>
    @font-face { font-family: 'Instrument Serif'; src: url(data:font/woff2;base64,${SERIF}) format('woff2'); }
    .rise { animation: rise linear infinite; }
    .sway { animation: sway ease-in-out infinite alternate; }
    .flicker { animation: flicker ease-in-out infinite alternate; }
    @keyframes rise { from { transform: translateY(0); } to { transform: translateY(-${H}px); } }
    @keyframes sway { from { transform: translateX(calc(var(--sway) * -1)); } to { transform: translateX(var(--sway)); } }
    @keyframes flicker { from { opacity: 1; } to { opacity: 0.15; } }
    @media (prefers-reduced-motion: reduce) { .rise, .sway, .flicker { animation: none; } }
  </style>
  <defs>
    <radialGradient id="bokeh">
      <stop offset="0%" stop-color="#fff"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="12"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="#000"/>
    <ellipse cx="${W / 2}" cy="${H / 2}" rx="420" ry="190" fill="url(#glow)"/>
${LAYERS.map(
  (l) => `
    <g class="sway" fill="${l.fill}" style="--sway: ${l.sway}px; animation-duration: ${(l.rise / 4).toFixed(1)}s">
      <g class="rise" style="animation-duration: ${l.rise}s">
        <g>${l.motes}</g>
        <g transform="translate(0 ${H})">${l.motes}</g>
      </g>
    </g>`,
).join('')}

    <text x="${W / 2}" y="${H / 2 + 30}" fill="#f2f2f2" font-family="${SERIF_STACK}" font-size="128" letter-spacing="1" text-anchor="middle">${HANDLE}</text>

    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#1f1f1f"/>
  </g>
</svg>
`

await writeFile(join(ROOT, 'assets', 'header.svg'), banner)

console.log(`✔ banner generated (${W}×${H}, ${LAYERS.reduce((n, l) => n + l.count, 0)} particles)`)
