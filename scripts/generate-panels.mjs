#!/usr/bin/env node
/**
 * Builds the two static panels of the profile, in ASCII under falling snow:
 * the banner (portrait and handle) and the about panel.
 *
 *   node scripts/generate-panels.mjs
 *
 * The portrait comes from assets/portrait.txt (see scripts/ascii-portrait.mjs).
 *
 * Outputs assets/{header,about}.svg
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ADVANCE, ASSETS, INK, RAMP, esc, panel } from './ascii.mjs'

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

async function banner() {
  const portrait = (await readFile(join(ASSETS, 'portrait.txt'), 'utf8')).trimEnd().split('\n')
  const SIZE = 6.4
  const LINE = SIZE * 1.1
  const H = 500
  const top = (H - portrait.length * LINE) / 2 + SIZE * 0.8

  const rows = portrait.map((line, i) => portraitRow(line, 56, top + i * LINE)).join('\n')

  const handle = HANDLE[0]
    .map((_, row) => HANDLE.map((letter) => letter[row]).join(' '))
    .map((line, i) => `    <text x="600" y="${168 + i * 24}" font-size="20" fill="${INK.bright}">${esc(line)}</text>`)
    .join('\n')

  return panel({
    w: W,
    h: H,
    label: 'lxwiq: an ASCII portrait in the snow',
    seed: 11,
    body: `  <g font-size="${SIZE}">
${rows}
  </g>
${handle}
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

const PROJECTS = [
  ['audiosort', 'organises audiobook collections'],
  ['palworld-wine-egg', "palworld's windows server under wine, so mods load"],
  ['jellyseerr-bulk-manager', 'bulk request management for jellyseerr'],
  ['ktc-edit', 'kingdom two crowns save editor in the browser'],
]

function about() {
  const SIZE = 17
  const LINE = 30
  const X = 64
  const col = (n) => X + n * SIZE * ADVANCE
  const lines = []
  let y = 72
  const line = (content) => {
    lines.push(content(y))
    y += LINE
  }
  const gap = () => (y += LINE * 0.6)

  for (const text of ABOUT) line((y) => `    <text x="${X}" y="${y}" fill="${INK.bright}">${esc(text)}</text>`)
  gap()
  for (const [key, value] of FIELDS) {
    line(
      (y) => `    <text x="${X}" y="${y}" fill="${INK.faint}">${key}</text>
    <text x="${col(9)}" y="${y}" fill="${INK.text}">${esc(value)}</text>`,
    )
  }
  gap()
  line((y) => `    <text x="${X}" y="${y}" fill="${INK.faint}">side projects</text>`)
  const nameWidth = Math.max(...PROJECTS.map(([name]) => name.length)) + 2
  PROJECTS.forEach(([name, description], i) => {
    const branch = i === PROJECTS.length - 1 ? '`-- ' : '|-- '
    const leader = ' ' + '.'.repeat(nameWidth - name.length - 1) + ' '
    line(
      (y) =>
        `    <text x="${X}" y="${y}"><tspan fill="${INK.faint}">${esc(branch)}</tspan><tspan fill="${INK.bright}">${esc(name)}</tspan><tspan fill="${INK.faint}">${leader}</tspan><tspan fill="${INK.muted}">${esc(description)}</tspan></text>`,
    )
  })

  const H = Math.round(y - LINE + 56)
  return panel({
    w: W,
    h: H,
    label: [...ABOUT, ...FIELDS.map((f) => f.join(': ')), ...PROJECTS.map((p) => p.join(': '))].join(' '),
    seed: 23,
    // Thinner here, so the flakes never crowd the text.
    density: 0.5,
    body: `  <g font-size="${SIZE}">
${lines.join('\n')}
  </g>`,
  })
}

/* -------------------------------------------------------------------- main */

await writeFile(join(ASSETS, 'header.svg'), await banner())
await writeFile(join(ASSETS, 'about.svg'), about())

console.log('✔ panels generated (header, about)')
