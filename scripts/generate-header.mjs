#!/usr/bin/env node
/**
 * Builds the profile banner in both themes: a monochrome winter forest under
 * slow snowfall, drawn procedurally from a fixed seed so every run gives the
 * same picture.
 *
 *   node scripts/generate-header.mjs
 *
 * Fonts and the film-grain tile are inlined as data URIs: GitHub serves README
 * images standalone, so the SVG cannot load anything from outside itself.
 *
 * Outputs assets/header-{dark,light}.svg
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const font = async (file) => (await readFile(join(ROOT, 'assets', 'fonts', file))).toString('base64')
const SERIF = await font('instrument-serif.woff2')
const SERIF_ITALIC = await font('instrument-serif-italic.woff2')

const W = 1200
const H = 320
const PAD = 64

// Pure greys, no tint: the banner should read as a black-and-white photograph.
const THEMES = {
  dark: {
    sky: ['#070707', '#1a1a1a'],
    fog: '#333333',
    haze: 0.1,
    ground: ['#2c2c2c', '#141414'],
    // far → near
    trees: ['#282828', '#1b1b1b', '#121212', '#060606'],
    snow: '#f2f2f2',
    fg: '#ececec',
    muted: '#a0a0a0',
    faint: '#666666',
    border: '#2b2b2b',
    vignette: 0.6,
    grain: 0.08,
  },
  light: {
    sky: ['#d4d4d1', '#ebebe8'],
    fog: '#f1f1ee',
    haze: 0.5,
    ground: ['#f7f7f5', '#e2e2df'],
    trees: ['#b4b4b1', '#878784', '#4a4a48', '#1e1e1d'],
    snow: '#ffffff',
    fg: '#141414',
    muted: '#505050',
    faint: '#8a8a8a',
    border: '#d4d4d4',
    vignette: 0.14,
    grain: 0.06,
  },
}

const SERIF_STACK = "'Instrument Serif', 'Iowan Old Style', Georgia, serif"
const MONO_STACK = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

/* ---------------------------------------------------------------- geometry */

// mulberry32 — tiny, seedable, good enough for scattering trees.
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
const path = (pts) => `M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`

/**
 * A spruce: tiers of drooping branches over a slowly wandering outline. Each
 * side runs notch → elbow → tip, so every branch sags at its end.
 */
function spruce(rand, x, base, h, w, detail = 5) {
  const tiers = Math.max(6, Math.round(h / detail))
  const top = base - h
  const crown = h * 0.94
  const step = crown / tiers
  const side = (dir) => {
    const phase = rand() * Math.PI * 2
    const pts = []
    for (let i = 1; i <= tiers; i++) {
      const t = i / tiers
      const y = top + t * crown
      const outline = 1 + 0.18 * Math.sin(t * 9 + phase)
      const reach = w * (0.06 + 0.94 * t ** 0.85) * outline * between(rand, 0.75, 1.2)
      pts.push([x + dir * reach * between(rand, 0.15, 0.3), y - step * 0.6])
      pts.push([x + dir * reach * 0.62, y - step * between(rand, 0.05, 0.3)])
      pts.push([x + dir * reach, y + step * between(rand, 0.4, 1.1)])
    }
    return pts
  }
  const trunk = Math.max(0.6, w * 0.05)
  return path([
    [x, top - h * 0.04],
    ...side(1),
    [x + trunk, base],
    [x - trunk, base],
    ...side(-1).reverse(),
  ])
}

/** A bare pine trunk running off the top of the frame, with a few dead twigs. */
function trunk(rand, x, base, w) {
  let d = path([
    [x - w, base],
    [x - w * 0.45, -4],
    [x + w * 0.45, -4],
    [x + w, base],
  ])
  const twigs = Math.round(between(rand, 1, 4))
  for (let i = 0; i < twigs; i++) {
    const y = between(rand, 30, base - 90)
    const dir = rand() < 0.5 ? -1 : 1
    const len = between(rand, 6, 16)
    const at = x + dir * w * 0.5
    d += path([
      [at, y],
      [at + dir * len, y + len * between(rand, 0.35, 0.7)],
      [at, y + between(rand, 1, 1.8)],
    ])
  }
  return d
}

const groundY = (x) => 246 + 5 * Math.sin(x / 170 + 0.6) + 3 * Math.sin(x / 61)

function forest() {
  const rand = prng(42)
  const layer = (count, place) => Array.from({ length: count }, () => place()).join('')

  const far = layer(90, () => {
    const h = between(rand, 36, 92)
    return spruce(rand, between(rand, 300, 1240), between(rand, 254, 262), h, h * between(rand, 0.17, 0.24), 9)
  })
  const mid = layer(36, () => {
    const h = between(rand, 80, 170)
    return spruce(rand, between(rand, 430, 1240), between(rand, 260, 270), h, h * between(rand, 0.15, 0.21), 7)
  })
  const trunks = layer(6, () => trunk(rand, between(rand, 600, 1180), between(rand, 262, 272), between(rand, 1.8, 4.5)))
  // The foreground trees overflow the frame top and bottom, like a lens too close to them.
  const near = [985, 1135]
    .map((x) => {
      const h = between(rand, 400, 440)
      return spruce(rand, x + between(rand, -20, 20), H + 40, h, h * between(rand, 0.15, 0.17))
    })
    .join('')

  let ground = `M0 ${r1(groundY(0))}`
  for (let x = 20; x <= W; x += 20) ground += `L${x} ${r1(groundY(x))}`
  ground += `L${W} ${H}L0 ${H}Z`

  return { far, mid, trunks, near, ground }
}

/** Three depths of flakes; each layer is drawn twice, stacked, so it loops seamlessly. */
function snowfall() {
  const rand = prng(2412)
  const depths = [
    { count: 70, r: [0.5, 1], opacity: [0.2, 0.45], fall: 46, sway: 9 },
    { count: 38, r: [1, 1.6], opacity: [0.35, 0.65], fall: 30, sway: 7 },
    { count: 12, r: [1.8, 2.6], opacity: [0.5, 0.8], fall: 19, sway: 5 },
  ]
  return depths.map((d) => {
    let flakes = ''
    for (let i = 0; i < d.count; i++) {
      flakes += `<circle cx="${r1(between(rand, 0, W))}" cy="${r1(between(rand, 0, H))}" r="${r1(between(rand, ...d.r))}" fill-opacity="${between(rand, ...d.opacity).toFixed(2)}"/>`
    }
    return { ...d, flakes }
  })
}

/* ------------------------------------------------------------------- grain */

// A tile of grey noise, encoded as a PNG by hand so the script stays dependency-free.
function grainTile(size) {
  const rand = prng(77)
  const raw = Buffer.alloc((size + 1) * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw[y * (size + 1) + 1 + x] = Math.round(((rand() + rand()) / 2) * 255)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

/* ------------------------------------------------------------------ banner */

const TREES = forest()
const SNOW = snowfall()
const GRAIN = grainTile(128)

const banner = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Loïc (@lxwiq), full-stack developer at Baguetoast, Strasbourg">
  <style>
    @font-face { font-family: 'Instrument Serif'; font-style: normal; src: url(data:font/woff2;base64,${SERIF}) format('woff2'); }
    @font-face { font-family: 'Instrument Serif'; font-style: italic; src: url(data:font/woff2;base64,${SERIF_ITALIC}) format('woff2'); }
    .fall { animation: fall linear infinite; }
    .sway { animation: sway ease-in-out infinite alternate; }
    @keyframes fall { from { transform: translateY(0); } to { transform: translateY(${H}px); } }
    @keyframes sway { from { transform: translateX(calc(var(--sway) * -1)); } to { transform: translateX(var(--sway)); } }
    @media (prefers-reduced-motion: reduce) { .fall, .sway { animation: none; } }
  </style>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.sky[0]}"/>
      <stop offset="78%" stop-color="${t.sky[1]}"/>
    </linearGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.fog}" stop-opacity="0"/>
      <stop offset="70%" stop-color="${t.fog}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${t.fog}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.ground[0]}"/>
      <stop offset="100%" stop-color="${t.ground[1]}"/>
    </linearGradient>
    <linearGradient id="reveal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="34%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="66%" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="hush" x1="0" y1="0" x2="1" y2="0">
      <stop offset="10%" stop-color="#fff" stop-opacity="0.25"/>
      <stop offset="55%" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <radialGradient id="haze" cx="0.72" cy="0.68" r="0.45">
      <stop offset="0%" stop-color="#fff" stop-opacity="${t.haze}"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.55" cy="0.5" r="0.75">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="${t.vignette}"/>
    </radialGradient>
    <mask id="forest"><rect width="${W}" height="${H}" fill="url(#reveal)"/></mask>
    <mask id="flurry"><rect width="${W}" height="${H}" fill="url(#hush)"/></mask>
    <pattern id="grain" width="128" height="128" patternUnits="userSpaceOnUse">
      <image href="data:image/png;base64,${GRAIN}" width="128" height="128"/>
    </pattern>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="12"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <rect width="${W}" height="${H}" fill="url(#haze)"/>

    <g mask="url(#forest)">
      <path d="${TREES.far}" fill="${t.trees[0]}"/>
      <rect y="120" width="${W}" height="150" fill="url(#fog)"/>
      <path d="${TREES.mid}" fill="${t.trees[1]}"/>
      <rect y="170" width="${W}" height="110" fill="url(#fog)" opacity="0.6"/>
      <path d="${TREES.trunks}" fill="${t.trees[2]}"/>
    </g>
    <path d="${TREES.ground}" fill="url(#ground)"/>
    <path d="${TREES.near}" fill="${t.trees[3]}" mask="url(#forest)"/>

    <g mask="url(#flurry)" fill="${t.snow}">${SNOW.map(
      (s) => `
      <g class="sway" style="--sway: ${s.sway}px; animation-duration: ${(s.fall / 3).toFixed(1)}s">
        <g class="fall" style="animation-duration: ${s.fall}s">
          <g>${s.flakes}</g>
          <g transform="translate(0 -${H})">${s.flakes}</g>
        </g>
      </g>`,
    ).join('')}
    </g>

    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    <rect width="${W}" height="${H}" fill="url(#grain)" opacity="${t.grain}"/>

    <text x="${PAD}" y="80" fill="${t.faint}" font-family="${MONO_STACK}" font-size="15" letter-spacing="4">@LXWIQ</text>
    <text x="${PAD - 4}" y="182" fill="${t.fg}" font-family="${SERIF_STACK}" font-size="116" letter-spacing="-1">Loïc</text>
    <text x="${PAD}" y="226" fill="${t.muted}" font-family="${SERIF_STACK}" font-style="italic" font-size="30">Full-stack developer at Baguetoast.</text>
    <text x="${PAD}" y="278" fill="${t.faint}" font-family="${MONO_STACK}" font-size="14" letter-spacing="3">STRASBOURG &#183; 48&#176;34&#8242;N 7&#176;45&#8242;E</text>

    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${t.border}"/>
  </g>
</svg>
`

for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(ROOT, 'assets', `header-${name}.svg`), banner(theme))
}

console.log(`✔ banner generated (${W}×${H})`)
