#!/usr/bin/env node
/**
 * Turns a picture into the ASCII portrait drawn on the banner. Run it again
 * whenever the profile picture changes:
 *
 *   node scripts/ascii-portrait.mjs avatar.png > assets/portrait.txt
 *
 * Reads 8-bit, non-interlaced PNGs (greyscale, RGB, with or without alpha)
 * with nothing but node:zlib, so the repo stays dependency-free.
 */

import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { ADVANCE, RAMP } from './ascii.mjs'

const COLS = 120
// Must match the banner, which sets each line at 1.1× the font size.
const CELL_ASPECT = ADVANCE / 1.1

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/ascii-portrait.mjs <picture.png>')
  process.exit(1)
}

/* -------------------------------------------------------------------- png */

function decodePng(buf) {
  let width, height, channels
  const idat = []
  for (let pos = 8; pos < buf.length; ) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs are supported')
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[9]]
      if (!channels) throw new Error('palette PNGs are not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    pos += 12 + len
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= channels ? px[y * stride + x - channels] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0
      const paeth = () => {
        const p = a + b - c
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth()][filter]) & 0xff
    }
  }

  // Luminance in 0..1, composited over black.
  const lum = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const p = px.subarray(i * channels, i * channels + channels)
    const grey = channels >= 3 ? 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] : p[0]
    const alpha = channels === 2 || channels === 4 ? p[channels - 1] / 255 : 1
    lum[i] = (grey / 255) * alpha
  }
  return { width, height, lum }
}

/* ------------------------------------------------------------------ ascii */

const { width, height, lum } = decodePng(await readFile(file))
const rows = Math.round(COLS * (height / width) * CELL_ASPECT)

// Average each cell, then stretch levels so the darker third of the frame
// (the forest behind) falls to empty space and the hair carries the picture.
const cells = []
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < COLS; c++) {
    const [x0, x1] = [Math.floor((c * width) / COLS), Math.floor(((c + 1) * width) / COLS)]
    const [y0, y1] = [Math.floor((r * height) / rows), Math.floor(((r + 1) * height) / rows)]
    let sum = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += lum[y * width + x]
    cells.push(sum / Math.max(1, (x1 - x0) * (y1 - y0)))
  }
}
const sorted = [...cells].sort((a, b) => a - b)
const lo = sorted[Math.floor(sorted.length * 0.3)]
const hi = sorted[Math.floor(sorted.length * 0.97)]

const smoothstep = (t) => t * t * (3 - 2 * t)
let out = ''
for (let r = 0; r < rows; r++) {
  let line = ''
  for (let c = 0; c < COLS; c++) {
    // Fade towards the edges so the picture dissolves into the black panel.
    const dx = (c + 0.5) / COLS - 0.5
    const dy = (r + 0.5) / rows - 0.5
    const fade = smoothstep(Math.min(1, Math.max(0, (0.56 - Math.hypot(dx, dy)) / 0.2)))
    const v = Math.min(1, Math.max(0, (cells[r * COLS + c] - lo) / (hi - lo))) ** 1.15 * fade
    line += RAMP[Math.round(v * (RAMP.length - 1))]
  }
  out += line.trimEnd() + '\n'
}
process.stdout.write(out)
