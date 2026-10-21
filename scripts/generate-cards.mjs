#!/usr/bin/env node
/**
 * Generates the contribution calendar used by README.md straight from the
 * GitHub API, so the profile never depends on a third-party stats service.
 *
 *   GITHUB_TOKEN=... node scripts/generate-cards.mjs
 *
 * Drawn in the same greys and type as the banner (scripts/generate-header.mjs):
 * Instrument Serif for the headline, the system monospace for every label.
 *
 * Outputs assets/calendar-{dark,light}.svg
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const USER = process.env.PROFILE_USER ?? 'lxwiq'
const TOKEN = process.env.GITHUB_TOKEN
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

/* ------------------------------------------------------------------ theme */

const THEMES = {
  dark: {
    bg: '#0a0a0a',
    fg: '#ececec',
    muted: '#8f8f8f',
    faint: '#5c5c5c',
    border: '#2b2b2b',
    // Empty ground to fresh snow.
    scale: ['#1a1a1a', '#3d3d3d', '#6e6e6e', '#a6a6a6', '#ececec'],
  },
  light: {
    bg: '#f5f5f3',
    fg: '#141414',
    muted: '#6a6a6a',
    faint: '#9a9a9a',
    border: '#d4d4d4',
    scale: ['#e6e6e3', '#c4c4c1', '#949492', '#5c5c5b', '#1c1c1c'],
  },
}

const SERIF = (await readFile(join(ASSETS, 'fonts', 'instrument-serif.woff2'))).toString('base64')
const SERIF_STACK = "'Instrument Serif', 'Iowan Old Style', Georgia, serif"
const MONO_STACK = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

/* ------------------------------------------------------------------- data */

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'lxwiq-profile-cards',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  const body = await res.json()
  if (body.errors) throw new Error(JSON.stringify(body.errors))
  return body.data
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`

async function fetchCalendar() {
  const { user } = await graphql(QUERY, { login: USER })
  const calendar = user.contributionsCollection.contributionCalendar
  const weeks = calendar.weeks.map((w) => w.contributionDays)
  const days = weeks.flat()

  // Streaks are measured up to the last day that already has data; today counts
  // only once something has landed, so an empty morning never breaks the run.
  let longest = 0
  let run = 0
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0
    if (run > longest) longest = run
  }
  let current = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++
    else if (i < days.length - 1) break
  }

  return { weeks, total: calendar.totalContributions, longestStreak: longest, currentStreak: current }
}

/* ----------------------------------------------------------------- svg kit */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

const num = (n) => n.toLocaleString('en-US')

// Every monospace face in the stack advances 0.6em or a hair less, so this
// never undershoots: labels can be right-aligned without clipping the frame.
const monoWidth = (str, size, spacing = 0) => String(str).length * (size * 0.6 + spacing)

const label = (t, x, y, text, { fill = t.faint, size = 13, spacing = 1.6, anchor = 'start' } = {}) =>
  `  <text x="${x}" y="${y}" fill="${fill}" font-family="${MONO_STACK}" font-size="${size}" letter-spacing="${spacing}" text-anchor="${anchor}">${esc(text)}</text>`

/* ------------------------------------------------------------ calendar card */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function calendarCard(t, cal) {
  const CELL = 14
  const STEP = CELL + 4
  const originX = 80
  const originY = 134
  const W = originX + cal.weeks.length * STEP + 36
  const H = originY + 7 * STEP + 68

  const peak = Math.max(...cal.weeks.flat().map((d) => d.contributionCount), 1)
  const level = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / peak) * 3.999)))

  let grid = ''
  const starts = []
  cal.weeks.forEach((week, w) => {
    const month = Number(week[0].date.slice(5, 7)) - 1
    if (month !== starts.at(-1)?.month) starts.push({ month, w })
    for (const day of week) {
      grid += `
    <rect x="${originX + w * STEP}" y="${originY + day.weekday * STEP}" width="${CELL}" height="${CELL}" rx="2" fill="${t.scale[level(day.contributionCount)]}"/>`
    }
  })

  // A month only gets a label once it has room for one: the partial month at
  // either end of the year would otherwise collide with its neighbour.
  const months = starts
    .filter(({ w }, i) => (starts[i + 1]?.w ?? cal.weeks.length) - w >= 3)
    .map(({ month, w }) => `\n${label(t, originX + w * STEP, originY - 12, MONTHS[month], { fill: t.muted, size: 12, spacing: 1.2 })}`)
    .join('')

  const dayLabels = [
    [1, 'MON'],
    [3, 'WED'],
    [5, 'FRI'],
  ]
    .map(([i, text]) => label(t, originX - 12, originY + i * STEP + 10, text, { size: 12, spacing: 1.2, anchor: 'end' }))
    .join('\n')

  // Right-aligned "LESS ▪▪▪▪▪ MORE", measured so it never clips the frame.
  const footY = originY + 7 * STEP + 38
  const moreX = W - 36 - monoWidth('MORE', 12, 1.2)
  const swatchX = moreX - 10 - 5 * STEP
  const legend = t.scale
    .map((c, i) => `  <rect x="${swatchX + i * STEP}" y="${footY - 11}" width="${CELL}" height="${CELL}" rx="2" fill="${c}"/>`)
    .join('\n')

  let streaks = ''
  let x = 36
  for (const [text, value] of [
    ['CURRENT STREAK', cal.currentStreak],
    ['LONGEST', cal.longestStreak],
  ]) {
    const days = `${num(value)} ${value === 1 ? 'DAY' : 'DAYS'}`
    streaks += `\n${label(t, x, footY, text)}\n${label(t, x + monoWidth(text, 13, 1.6) + 8, footY, days, { fill: t.fg })}`
    x += monoWidth(text, 13, 1.6) + 8 + monoWidth(days, 13, 1.6) + 36
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${cal.total} contributions by ${USER} in the last year`)}">
  <style>
    @font-face { font-family: 'Instrument Serif'; src: url(data:font/woff2;base64,${SERIF}) format('woff2'); }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
${label(t, 36, 48, 'PUBLIC ACTIVITY · LAST 12 MONTHS', { spacing: 2.8 })}
  <text x="34" y="92" fill="${t.fg}" font-family="${SERIF_STACK}" font-size="40">${num(cal.total)} contributions</text>${months}
${dayLabels}
  <g>${grid}
  </g>${streaks}
${legend}
${label(t, swatchX - 10, footY, 'LESS', { size: 12, spacing: 1.2, anchor: 'end' })}
${label(t, moreX, footY, 'MORE', { size: 12, spacing: 1.2 })}
</svg>
`
}

/* -------------------------------------------------------------------- main */

const calendar = await fetchCalendar()

for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(ASSETS, `calendar-${name}.svg`), calendarCard(theme, calendar))
}

console.log(
  `✔ calendar generated — ${calendar.total} contributions ` +
    `(streak ${calendar.currentStreak}d, best ${calendar.longestStreak}d)`,
)
