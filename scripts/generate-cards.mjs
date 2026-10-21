#!/usr/bin/env node
/**
 * Generates the live panels of README.md straight from the GitHub API, so the
 * profile never depends on a third-party stats service: the most starred
 * repositories and the contribution calendar.
 *
 *   GITHUB_TOKEN=... node scripts/generate-cards.mjs
 *
 * Drawn like the other panels (scripts/ascii.mjs): ASCII on black, under
 * falling snow. The README's links to those repositories, which an image
 * cannot carry, are rewritten between the top-repos markers.
 *
 * Outputs assets/{repos,calendar}.svg and updates README.md
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ADVANCE, ASSETS, INK, TEXT, esc, panel } from './ascii.mjs'

const USER = process.env.PROFILE_USER ?? 'lxwiq'
const TOKEN = process.env.GITHUB_TOKEN
const README = join(ASSETS, '..', 'README.md')
const TOP = 6

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

// Public repos only — a link to a private one 404s for every visitor.
const QUERY = `
query ($login: String!) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 20, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes { name url description stargazerCount primaryLanguage { name } }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`

async function fetchProfile() {
  const { user } = await graphql(QUERY, { login: USER })
  // The profile repository is this README; it has no place in its own list.
  const repos = user.repositories.nodes.filter((r) => r.name.toLowerCase() !== USER.toLowerCase()).slice(0, TOP)
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

  return {
    repos,
    calendar: { weeks, total: calendar.totalContributions, longestStreak: longest, currentStreak: current },
  }
}

/* --------------------------------------------------------------- repos card */

function reposCard(repos) {
  const W = 1200
  const cols = Math.floor((W - TEXT.x * 2) / (TEXT.size * ADVANCE))
  const nameWidth = Math.max(...repos.map((r) => r.name.length)) + 2
  const starsWidth = Math.max(...repos.map((r) => String(r.stargazerCount).length))
  const descWidth = cols - 4 - (nameWidth + 1) - (starsWidth + 5) - 12

  const clip = (text, width) => (text.length > width ? `${text.slice(0, width - 1).trimEnd()}…` : text)

  let y = 72
  let lines = `    <text x="${TEXT.x}" y="${y}" fill="${INK.faint}">most starred</text>`
  repos.forEach((r, i) => {
    y += TEXT.line
    const branch = i === repos.length - 1 ? '`-- ' : '|-- '
    const leader = ` ${'.'.repeat(nameWidth - r.name.length - 1)} `
    const stars = `* ${String(r.stargazerCount).padStart(starsWidth)}   `
    const lang = (r.primaryLanguage?.name ?? '').toLowerCase().padEnd(12)
    const desc = clip((r.description ?? '').toLowerCase(), descWidth)
    lines += `
    <text x="${TEXT.x}" y="${y}"><tspan fill="${INK.faint}">${esc(branch)}</tspan><tspan fill="${INK.bright}">${esc(r.name.toLowerCase())}</tspan><tspan fill="${INK.faint}">${leader}</tspan><tspan fill="${INK.text}">${esc(stars)}</tspan><tspan fill="${INK.faint}">${esc(lang)}</tspan><tspan fill="${INK.muted}">${esc(desc)}</tspan></text>`
  })

  return panel({
    w: W,
    h: y + 56,
    label: `Most starred repositories: ${repos.map((r) => `${r.name} (${r.stargazerCount} stars)`).join(', ')}`,
    seed: 31,
    density: 0.5,
    body: `  <g font-size="${TEXT.size}">
${lines}
  </g>`,
  })
}

/** Rewrites the links under the panels, which an image cannot carry. */
async function updateReadme(repos) {
  const START = '<!-- top-repos:start -->'
  const END = '<!-- top-repos:end -->'
  const readme = await readFile(README, 'utf8')
  const from = readme.indexOf(START)
  const to = readme.indexOf(END)
  if (from < 0 || to < from) {
    console.warn('⚠ top-repos markers not found in README.md — links left as they are')
    return
  }
  const links = repos.map((r) => `    <a href="${esc(r.url)}">${esc(r.name.toLowerCase())}</a>`).join(' ·\n')
  await writeFile(README, `${readme.slice(0, from + START.length)}\n${links}\n    ${readme.slice(to)}`)
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

const { repos, calendar } = await fetchProfile()

await writeFile(join(ASSETS, 'repos.svg'), reposCard(repos))
await writeFile(join(ASSETS, 'calendar.svg'), calendarCard(calendar))
await updateReadme(repos)

console.log(
  `✔ panels generated — top ${repos.length} repos (${repos.map((r) => `${r.name} ${r.stargazerCount}★`).join(', ')}), ` +
    `${calendar.total} contributions (streak ${calendar.currentStreak}d, best ${calendar.longestStreak}d)`,
)
