#!/usr/bin/env node
/**
 * Generates the contribution calendar used by README.md straight from the
 * GitHub API, so the profile never depends on a third-party stats service.
 *
 *   GITHUB_TOKEN=... node scripts/generate-cards.mjs
 *
 * Drawn like the other panels (scripts/ascii.mjs): ASCII on black, under
 * falling snow, each day a glyph that settles heavier as activity grows.
 *
 * Outputs assets/calendar.svg
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ADVANCE, ASSETS, INK, esc, panel } from './ascii.mjs'

const USER = process.env.PROFILE_USER ?? 'lxwiq'
const TOKEN = process.env.GITHUB_TOKEN

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

// No contributions to the busiest days.
const LEVELS = [
  ['.', 0.3],
  [':', 0.5],
  ['+', 0.7],
  ['*', 0.85],
  ['#', 1],
]

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

/* ------------------------------------------------------------ calendar card */

const num = (n) => n.toLocaleString('en-US')

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function calendarCard(cal) {
  const W = 1200
  const STEP = 18
  const LABEL = 14
  const gridW = cal.weeks.length * STEP
  const originX = Math.round((W - gridW) / 2 + 20)
  const originY = 130
  const H = originY + 7 * STEP + 76

  const peak = Math.max(...cal.weeks.flat().map((d) => d.contributionCount), 1)
  const level = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / peak) * 3.999)))

  let grid = ''
  const starts = []
  cal.weeks.forEach((week, w) => {
    const month = Number(week[0].date.slice(5, 7)) - 1
    if (month !== starts.at(-1)?.month) starts.push({ month, w })
    for (const day of week) {
      const [glyph, opacity] = LEVELS[level(day.contributionCount)]
      grid += `<text x="${originX + w * STEP + STEP / 2}" y="${originY + day.weekday * STEP + 12}" fill-opacity="${opacity}">${esc(glyph)}</text>`
    }
  })

  // A month only gets a label once it has room for one: the partial month at
  // either end of the year would otherwise collide with its neighbour.
  const months = starts
    .filter(({ w }, i) => (starts[i + 1]?.w ?? cal.weeks.length) - w >= 3)
    .map(({ month, w }) => `<text x="${originX + w * STEP + 4}" y="${originY - 14}">${MONTHS[month]}</text>`)
    .join('')

  const days = [
    [1, 'mon'],
    [3, 'wed'],
    [5, 'fri'],
  ]
    .map(([i, text]) => `<text x="${originX - 10}" y="${originY + i * STEP + 12}" text-anchor="end">${text}</text>`)
    .join('')

  const footY = originY + 7 * STEP + 40
  const streaks = `current streak <tspan fill="${INK.bright}">${num(cal.currentStreak)}d</tspan>   longest <tspan fill="${INK.bright}">${num(cal.longestStreak)}d</tspan>`
  const legend = `less ${LEVELS.map(([glyph, opacity]) => `<tspan fill="${INK.bright}" fill-opacity="${opacity}">${esc(glyph)}</tspan>`).join(' ')} more`
  const legendW = (4 + 1 + LEVELS.length * 2 + 4) * LABEL * ADVANCE

  return panel({
    w: W,
    h: H,
    label: `${cal.total} contributions by ${USER} in the last year`,
    seed: 37,
    density: 0.35,
    body: `    <text x="${originX - 40}" y="58" font-size="20" fill="${INK.bright}">${num(cal.total)} contributions</text>
    <text x="${originX - 40}" y="86" font-size="14" fill="${INK.muted}">public activity, last 12 months</text>
    <g font-size="${LABEL}" fill="${INK.muted}">${months}${days}</g>
    <g font-size="15" fill="${INK.bright}" text-anchor="middle">${grid}</g>
    <text x="${originX - 40}" y="${footY}" font-size="${LABEL}" fill="${INK.muted}">${streaks}</text>
    <text x="${Math.round(originX + gridW - legendW)}" y="${footY}" font-size="${LABEL}" fill="${INK.muted}">${legend}</text>`,
  })
}

/* -------------------------------------------------------------------- main */

const calendar = await fetchCalendar()

await writeFile(join(ASSETS, 'calendar.svg'), calendarCard(calendar))

console.log(
  `✔ calendar generated — ${calendar.total} contributions ` +
    `(streak ${calendar.currentStreak}d, best ${calendar.longestStreak}d)`,
)
