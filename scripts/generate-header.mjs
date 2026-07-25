#!/usr/bin/env node
/**
 * Builds the profile banner in both themes.
 *
 *   node scripts/generate-header.mjs
 *
 * The Baguetoast mascot is inlined as a data URI: GitHub serves README images
 * through camo, standalone, so a relative <image href> would never resolve.
 *
 * Outputs assets/header-{dark,light}.svg
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const mascot = (await readFile(join(ROOT, 'assets', 'mascot.png'))).toString('base64')

const W = 1200
const H = 260
const PAD = 56
const ICON = 148
const ICON_X = W - PAD - ICON
const ICON_Y = (H - ICON) / 2

// Primer tokens, same palette as the stat cards.
const THEMES = {
  dark: {
    bg: ['#0d1117', '#151b23'],
    border: '#3d444d',
    fg: '#f0f6fc',
    muted: '#9198a1',
    faint: '#656c76',
    accent: '#e3b341',
    glow: 0.14,
  },
  light: {
    bg: ['#ffffff', '#f6f8fa'],
    border: '#d1d9e0',
    fg: '#1f2328',
    muted: '#59636e',
    faint: '#818b98',
    accent: '#9a6700',
    glow: 0.16,
  },
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"

const banner = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Loïc (@lxwiq) — Full-stack Developer at Baguetoast" font-family="${FONT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${t.bg[0]}"/>
      <stop offset="100%" stop-color="${t.bg[1]}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="45%" stop-color="#f0883e" stop-opacity="${t.glow}"/>
      <stop offset="100%" stop-color="#f0883e" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="card"><rect x="0" y="0" width="${W}" height="${H}" rx="12"/></clipPath>
    <clipPath id="icon"><rect x="${ICON_X}" y="${ICON_Y}" width="${ICON}" height="${ICON}" rx="30"/></clipPath>
  </defs>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <circle cx="${ICON_X + ICON / 2}" cy="${H / 2}" r="180" fill="url(#glow)"/>

    <text x="${PAD}" y="68" fill="${t.accent}" font-size="13" font-weight="600" letter-spacing="3.4">LOÏC &#183; @LXWIQ</text>
    <text x="${PAD}" y="124" fill="${t.fg}" font-size="42" font-weight="700" letter-spacing="-0.8">Full-stack Developer</text>
    <text x="${PAD}" y="172" fill="${t.accent}" font-size="42" font-weight="700" letter-spacing="-0.8">@ Baguetoast</text>
    <text x="${PAD}" y="206" fill="${t.muted}" font-size="16.5">Artisan game server hosting, baked fresh in France.</text>
    <text x="${PAD}" y="236" fill="${t.faint}" font-size="12.5" letter-spacing="1.6">STRASBOURG, FR &#160;&#183;&#160; ELIXIR &#183; TYPESCRIPT &#183; SVELTE &#183; GO &#183; KOTLIN</text>

    <image href="data:image/png;base64,${mascot}" x="${ICON_X}" y="${ICON_Y}" width="${ICON}" height="${ICON}" clip-path="url(#icon)" preserveAspectRatio="xMidYMid slice"/>
    <rect x="${ICON_X + 0.5}" y="${ICON_Y + 0.5}" width="${ICON - 1}" height="${ICON - 1}" rx="30" fill="none" stroke="${t.border}"/>

    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${t.border}"/>
  </g>
</svg>
`

for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(ROOT, 'assets', `header-${name}.svg`), banner(theme))
}

console.log(`✔ banner generated (${W}×${H}, mascot inlined at ${Math.round(mascot.length / 1024)}kB base64)`)
