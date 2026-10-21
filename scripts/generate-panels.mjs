#!/usr/bin/env node
/**
 * Builds the two static panels of the profile, in ASCII under falling snow:
 * the banner (portrait and animated handle) and the about panel.
 *
 *   node scripts/generate-panels.mjs
 *
 * The portrait comes from assets/portrait.txt (see scripts/ascii-portrait.mjs).
 *
 * Outputs assets/{header,about}.svg
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ADVANCE, ASSETS, INK, RAMP, TEXT, esc, panel, prng } from './ascii.mjs'

const W = 1200

/* ------------------------------------------------------------------ banner */

// figlet "standard", one column between letters.
const HANDLE = [
  [' _ ', '| |', '| |', '| |', '|_|', '   '],
  ['      ', '__  __', '\\ \\/ /', ' >  < ', '/_/\\_\\', '      '],
  ['          ', '__      __', '\\ \\ /\\ / /', ' \\ V  V / ', '  \\_/\\_/  ', '          '],
  [' _ ', '(_)', '| |', '| |', '|_|', '   '],
  ['       ', '  __ _ ', ' / _` |', '| (_| |', ' \\__, |', '    |_|'],
]

/** Brighter glyphs get brighter ink, so the portrait keeps its depth. */
const inkFor = (glyph) => {
  const level = RAMP.indexOf(glyph) / (RAMP.length - 1)
  return level > 0.65 ? INK.bright : level > 0.35 ? INK.muted : INK.faint
}

function portraitRow(line, x, y) {
  let spans = ''
  for (const run of line.match(/(.)\1*|\s+/g) ?? []) {
    spans += run.trim() ? `<tspan fill="${inkFor(run[0])}">${esc(run)}</tspan>` : run
  }
  return `    <text x="${x}" y="${y}">${spans}</text>`
}

// The handle decodes: each glyph flicks through a few random ones before it
// settles, sweeping left to right, and the whole decode replays every CYCLE.
const SCRAMBLE = '/\\|_-=+*#%@<>[]{}:'
const CYCLE = 9
const TICK = 0.06
const FRAMES = 5

function handle(x, y) {
  const SIZE = 20
  const LINE = 24
  const rand = prng(5)
  const pct = (seconds) => ((seconds / CYCLE) * 100).toFixed(3)

  let glyphs = ''
  HANDLE[0]
    .map((_, row) => HANDLE.map((letter) => letter[row]).join(' '))
    .forEach((line, row) => {
      ;[...line].forEach((glyph, col) => {
        if (glyph === ' ') return
        const at = `x="${(x + col * SIZE * ADVANCE).toFixed(1)}" y="${y + row * LINE}"`
        const start = col * 0.03 + row * 0.015
        for (let f = 0; f < FRAMES; f++) {
          const noise = SCRAMBLE[Math.floor(rand() * SCRAMBLE.length)]
          glyphs += `<text ${at} class="blip" fill="${INK.muted}" style="animation-delay: ${(start + f * TICK).toFixed(2)}s">${esc(noise)}</text>`
        }
        glyphs += `<text ${at} class="hold" style="animation-delay: ${start.toFixed(2)}s">${esc(glyph)}</text>`
      })
    })

  return {
    body: `    <g font-size="${SIZE}" fill="${INK.bright}">${glyphs}</g>`,
    // Settled glyphs stay visible wherever CSS animations do not run; the
    // scramble frames only ever exist while their animation plays.
    css: `
    .blip { opacity: 0; animation: blip ${CYCLE}s step-end infinite; }
    .hold { animation: hold ${CYCLE}s step-end infinite backwards; }
    @keyframes blip { 0% { opacity: 1; } ${pct(TICK)}% { opacity: 0; } 100% { opacity: 0; } }
    @keyframes hold { 0% { opacity: 0; } ${pct(FRAMES * TICK)}% { opacity: 1; } 100% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .blip { display: none; } .hold { animation: none; } }`,
  }
}

async function banner() {
  const portrait = (await readFile(join(ASSETS, 'portrait.txt'), 'utf8')).trimEnd().split('\n')
  const SIZE = 6.4
  const LINE = SIZE * 1.1
  const H = 500
  const top = (H - portrait.length * LINE) / 2 + SIZE * 0.8

  const rows = portrait.map((line, i) => portraitRow(line, 56, top + i * LINE)).join('\n')
  const name = handle(600, 168)

  return panel({
    w: W,
    h: H,
    label: 'lxwiq: an ASCII portrait in the snow',
    seed: 11,
    css: name.css,
    body: `  <g font-size="${SIZE}">
${rows}
  </g>
${name.body}
    <text x="602" y="370" font-size="17" fill="${INK.text}">full-stack developer</text>
    <text x="602" y="400" font-size="14" fill="${INK.muted}" letter-spacing="1">strasbourg, france · 48°34′N 7°45′E</text>`,
  })
}

/* ------------------------------------------------------------------- about */

const ABOUT = [
  'i build baguetoast, game server hosting made in france,',
  'from the elixir control plane down to the bare-metal nodes.',
  'on the side, i write self-hosting tools i actually use.',
]

const FIELDS = [
  ['now', 'the new baguetoast dashboard'],
  ['stack', 'elixir · phoenix · typescript · svelte · go · kotlin · postgresql · docker'],
]

function about() {
  const col = (n) => TEXT.x + n * TEXT.size * ADVANCE
  const lines = []
  let y = 72
  const line = (content) => {
    lines.push(content(y))
    y += TEXT.line
  }

  for (const text of ABOUT) line((y) => `    <text x="${TEXT.x}" y="${y}" fill="${INK.bright}">${esc(text)}</text>`)
  y += TEXT.line * 0.6
  for (const [key, value] of FIELDS) {
    line(
      (y) => `    <text x="${TEXT.x}" y="${y}" fill="${INK.faint}">${key}</text>
    <text x="${col(9)}" y="${y}" fill="${INK.text}">${esc(value)}</text>`,
    )
  }

  return panel({
    w: W,
    h: Math.round(y - TEXT.line + 56),
    label: [...ABOUT, ...FIELDS.map((f) => f.join(': '))].join(' '),
    seed: 23,
    // Thinner here, so the flakes never crowd the text.
    density: 0.5,
    body: `  <g font-size="${TEXT.size}">
${lines.join('\n')}
  </g>`,
  })
}

/* -------------------------------------------------------------------- main */

await writeFile(join(ASSETS, 'header.svg'), await banner())
await writeFile(join(ASSETS, 'about.svg'), about())

console.log('✔ panels generated (header, about)')
