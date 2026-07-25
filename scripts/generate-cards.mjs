#!/usr/bin/env node
/**
 * Generates the SVG cards used by README.md straight from the GitHub API,
 * so the profile never depends on a third-party stats service being up.
 *
 *   GITHUB_TOKEN=... node scripts/generate-cards.mjs
 *
 * Outputs assets/{stats,langs,projects}-{dark,light}.svg
 */

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const USER = process.env.PROFILE_USER ?? 'lxwiq'
const TOKEN = process.env.GITHUB_TOKEN
const FEATURED = ['JellyFish', 'AudioSort', 'palworld-wine-egg', 'soundground']
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

/* ------------------------------------------------------------------ theme */

const THEMES = {
  dark: {
    bg: ['#181209', '#0F0C08', '#090706'],
    glow: '#F5C24B',
    glowOpacity: [0.2, 0.05],
    dot: '#F5C24B',
    dotOpacity: 0.055,
    border: '#3A2C17',
    title: '#F5C24B',
    value: '#F8F1E4',
    label: '#B49E85',
    faint: '#7C6C5A',
    accent: '#E0862A',
    track: '#2A2014',
    scale: ['#1B1409', '#4A3512', '#8A6018', '#C99128', '#F5C24B'],
  },
  light: {
    bg: ['#FFFCF5', '#FEF6E7', '#FBEBD2'],
    glow: '#F0A62E',
    glowOpacity: [0.18, 0.04],
    dot: '#B4651C',
    dotOpacity: 0.07,
    border: '#EBD4AE',
    title: '#B4651C',
    value: '#231A11',
    label: '#6B5847',
    faint: '#94806C',
    accent: '#C2740F',
    track: '#F2E1C6',
    scale: ['#F4E6CC', '#F0CE94', '#E0A03A', '#C2740F', '#8A4A0C'],
  },
}

const FONT = "'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif"

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
    followers { totalCount }
    following { totalCount }
    pullRequests { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: { field: STARGAZERS, direction: DESC }) {
      totalCount
      nodes {
        name
        description
        stargazerCount
        forkCount
        primaryLanguage { name color }
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`

async function fetchProfile() {
  const { user } = await graphql(QUERY, { login: USER })
  const repos = user.repositories.nodes

  const bytes = new Map()
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      const prev = bytes.get(node.name) ?? { size: 0, color: node.color ?? '#8b8b8b' }
      prev.size += size
      bytes.set(node.name, prev)
    }
  }
  const total = [...bytes.values()].reduce((acc, l) => acc + l.size, 0) || 1
  const langs = [...bytes.entries()]
    .map(([name, l]) => ({ name, color: l.color, share: (l.size / total) * 100 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 8)

  const c = user.contributionsCollection
  const weeks = c.contributionCalendar.weeks.map((w) => w.contributionDays)
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
    calendar: { weeks, longestStreak: longest, currentStreak: current },
    stats: {
      commits: c.totalCommitContributions + c.restrictedContributionsCount,
      contributions: c.contributionCalendar.totalContributions,
      reviews: c.totalPullRequestReviewContributions,
      prs: user.pullRequests.totalCount,
      repos: user.repositories.totalCount,
      stars: repos.reduce((acc, r) => acc + r.stargazerCount, 0),
      followers: user.followers.totalCount,
      following: user.following.totalCount,
    },
    langs,
    projects: FEATURED.map((name) => repos.find((r) => r.name === name)).filter(Boolean),
  }
}

/* ------------------------------------------------------------------ svg kit */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

/** Rough advance width in em units — good enough to wrap and truncate reliably. */
const WIDE = new Set('ABCDEFGHKNOPQRSTUVXYZmwo@#%&'.split(''))
const NARROW = new Set('ijlt.,:;!|\'`[]()/ '.split(''))
function textWidth(str, size) {
  let em = 0
  for (const ch of str) em += WIDE.has(ch) ? 0.62 : NARROW.has(ch) ? 0.3 : 0.52
  return em * size
}

function truncate(str, size, max) {
  if (textWidth(str, size) <= max) return str
  let out = ''
  for (const ch of str) {
    if (textWidth(out + ch + '…', size) > max) break
    out += ch
  }
  return out.trimEnd() + '…'
}

function wrap(str, size, max, maxLines) {
  const words = str.split(/\s+/).filter(Boolean)
  const out = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next, size) > max && line) {
      out.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  if (out.length <= maxLines) return out
  // Overflow: pack whatever still fits onto the last visible line, then ellipsise.
  const kept = out.slice(0, maxLines)
  kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} ${out.slice(maxLines).join(' ')}`, size, max)
  return kept
}

function chrome(t, w, h, id) {
  return `  <defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${t.bg[0]}"/>
      <stop offset="55%" stop-color="${t.bg[1]}"/>
      <stop offset="100%" stop-color="${t.bg[2]}"/>
    </linearGradient>
    <radialGradient id="glow${id}" cx="0.9" cy="0.06" r="0.85">
      <stop offset="0%" stop-color="${t.glow}" stop-opacity="${t.glowOpacity[0]}"/>
      <stop offset="55%" stop-color="${t.accent}" stop-opacity="${t.glowOpacity[1]}"/>
      <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${t.title}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${t.title}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="dots${id}" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.4" cy="1.4" r="1.4" fill="${t.dot}" fill-opacity="${t.dotOpacity}"/>
    </pattern>
    <clipPath id="card${id}"><rect x="0" y="0" width="${w}" height="${h}" rx="22"/></clipPath>
  </defs>
  <g clip-path="url(#card${id})">
    <rect width="${w}" height="${h}" fill="url(#bg${id})"/>
    <rect width="${w}" height="${h}" fill="url(#dots${id})"/>
    <rect width="${w}" height="${h}" fill="url(#glow${id})"/>`
}

const frame = (t, w, h) =>
  `    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="22" fill="none" stroke="${t.border}" stroke-width="2"/>
  </g>`

/** Card title + the amber accent rule that ties every card back to the banner. */
function heading(t, id, x, y, label) {
  return `    <text x="${x}" y="${y}" fill="${t.value}" font-size="23" font-weight="700" letter-spacing="-0.3">${esc(label)}</text>
    <rect x="${x}" y="${y + 14}" width="120" height="2.5" rx="1.25" fill="url(#rule${id})"/>`
}

const fadeIn = (delay) =>
  `<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${delay}s" fill="freeze"/>`

/* ---------------------------------------------------------------- stat card */

function statsCard(t, id, stats) {
  const W = 520
  const H = 286
  const items = [
    ['Commits (last year)', stats.commits],
    ['Public repos', stats.repos],
    ['Pull requests', stats.prs],
    ['Stars earned', stats.stars],
    ['Code reviews', stats.reviews],
    ['Followers', stats.followers],
    ['Contributions (last year)', stats.contributions],
    ['Following', stats.following],
  ]

  let body = ''
  items.forEach(([label, value], i) => {
    const col = i % 2
    const row = (i - col) / 2
    const x = 40 + col * 244
    const y = 112 + row * 44
    body += `
    <g>${fadeIn(0.15 + i * 0.06)}
      <circle cx="${x + 3}" cy="${y - 5}" r="3" fill="${t.accent}"/>
      <text x="${x + 16}" y="${y}" fill="${t.label}" font-size="14.5">${esc(label)}</text>
      <text x="${x + 214}" y="${y}" fill="${t.value}" font-size="17" font-weight="700" text-anchor="end">${value.toLocaleString('en-US')}</text>
    </g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub statistics for ${USER}" font-family="${FONT}">
${chrome(t, W, H, id)}
${heading(t, id, 40, 58, 'GitHub stats')}${body}
${frame(t, W, H)}
</svg>
`
}

/* ---------------------------------------------------------------- lang card */

function langsCard(t, id, langs) {
  const W = 520
  const H = 286
  const barX = 40
  const barW = W - 80
  const barY = 100

  let bar = ''
  let cursor = barX
  langs.forEach((l, i) => {
    const w = Math.max((l.share / 100) * barW, 2)
    bar += `
      <rect x="${cursor.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="16" fill="${l.color}">
        <animate attributeName="width" from="0" to="${w.toFixed(2)}" dur="0.8s" begin="${(0.1 + i * 0.07).toFixed(2)}s" fill="freeze"/>
      </rect>`
    cursor += w
  })

  let legend = ''
  langs.forEach((l, i) => {
    const col = i % 2
    const row = (i - col) / 2
    const x = 40 + col * 236
    const y = 150 + row * 32
    const name = truncate(l.name, 14.5, 132)
    legend += `
    <g>${fadeIn(0.3 + i * 0.06)}
      <circle cx="${x + 5}" cy="${y - 5}" r="5.5" fill="${l.color}"/>
      <text x="${x + 20}" y="${y}" fill="${t.label}" font-size="14.5">${esc(name)}</text>
      <text x="${x + 200}" y="${y}" fill="${t.value}" font-size="14.5" font-weight="700" text-anchor="end">${l.share.toFixed(1)}%</text>
    </g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Most used languages by ${USER}" font-family="${FONT}">
  <defs>
    <clipPath id="bar${id}"><rect x="${barX}" y="${barY}" width="${barW}" height="16" rx="8"/></clipPath>
  </defs>
${chrome(t, W, H, id)}
${heading(t, id, 40, 58, 'Most used languages')}
    <rect x="${barX}" y="${barY}" width="${barW}" height="16" rx="8" fill="${t.track}"/>
    <g clip-path="url(#bar${id})">${bar}
    </g>${legend}
${frame(t, W, H)}
</svg>
`
}

/* ------------------------------------------------------------- project card */

function projectsCard(t, id, projects) {
  const W = 1060
  const CARD_W = 500
  const CARD_H = 152
  const rows = Math.ceil(projects.length / 2)
  const H = 10 + rows * (CARD_H + 20)

  let body = ''
  projects.forEach((p, i) => {
    const col = i % 2
    const row = (i - col) / 2
    const x = 30 + col * (CARD_W + 20)
    const y = 20 + row * (CARD_H + 20)
    const lang = p.primaryLanguage
    const desc = wrap(p.description ?? '', 13.5, CARD_W - 56, 2)
    const descLines = desc
      .map((line, j) => `      <text x="${x + 28}" y="${y + 66 + j * 20}" fill="${t.label}" font-size="13.5">${esc(line)}</text>`)
      .join('\n')

    body += `
    <g>${fadeIn(0.15 + i * 0.1)}
      <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="16" fill="${t.dot}" fill-opacity="0.035" stroke="${t.border}" stroke-width="1.5"/>
      <rect x="${x}" y="${y + 18}" width="4" height="${CARD_H - 36}" rx="2" fill="${t.accent}"/>
      <text x="${x + 28}" y="${y + 40}" fill="${t.title}" font-size="18" font-weight="700">${esc(truncate(p.name, 18, CARD_W - 120))}</text>
${descLines}
      <g transform="translate(${x + 28} ${y + CARD_H - 26})">
        ${lang ? `<circle cx="6" cy="-4.5" r="6" fill="${lang.color ?? t.accent}"/>
        <text x="20" y="0" fill="${t.faint}" font-size="13">${esc(lang.name)}</text>` : ''}
        <g transform="translate(${lang ? Math.round(30 + textWidth(lang.name, 13)) : 0} 0)">
          <path d="M7 -14.5 L9 -10.4 L13.5 -9.8 L10.2 -6.6 L11 -2.1 L7 -4.2 L3 -2.1 L3.8 -6.6 L0.5 -9.8 L5 -10.4 Z" fill="${t.accent}"/>
          <text x="20" y="0" fill="${t.faint}" font-size="13">${p.stargazerCount} stars</text>
          <text x="${20 + Math.round(textWidth(`${p.stargazerCount} stars`, 13)) + 10}" y="0" fill="${t.faint}" font-size="13">·  ${p.forkCount} forks</text>
        </g>
      </g>
    </g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Featured projects by ${USER}" font-family="${FONT}">
${chrome(t, W, H, id)}${body}
${frame(t, W, H)}
</svg>
`
}

/* ------------------------------------------------------------ calendar card */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function calendarCard(t, id, cal, totalContributions) {
  const CELL = 13
  const GAP = 4
  const STEP = CELL + GAP
  const originX = 68
  const originY = 122
  const W = originX + cal.weeks.length * STEP + 30
  const H = originY + 7 * STEP + 74

  const peak = Math.max(...cal.weeks.flat().map((d) => d.contributionCount), 1)
  const level = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / peak) * 3.999)))

  let grid = ''
  let months = ''
  let lastMonth = -1
  cal.weeks.forEach((week, w) => {
    const first = week[0]
    const month = Number(first.date.slice(5, 7)) - 1
    if (month !== lastMonth && w < cal.weeks.length - 2) {
      months += `
    <text x="${originX + w * STEP}" y="${originY - 12}" fill="${t.faint}" font-size="12">${MONTHS[month]}</text>`
      lastMonth = month
    }
    for (const day of week) {
      const x = originX + w * STEP
      const y = originY + day.weekday * STEP
      grid += `
      <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3.5" fill="${t.scale[level(day.contributionCount)]}">
        <animate attributeName="opacity" from="0" to="1" dur="0.45s" begin="${(0.1 + w * 0.012).toFixed(3)}s" fill="freeze"/>
      </rect>`
    }
  })

  const dayLabels = [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ]
    .map(
      ([i, label]) =>
        `    <text x="${originX - 12}" y="${originY + i * STEP + 11}" fill="${t.faint}" font-size="11.5" text-anchor="end">${label}</text>`,
    )
    .join('\n')

  // "Less" + swatches + "More", right-aligned with the same 34px gutter as the frame.
  const legendW = 30 + 8 + 5 * STEP + 8 + 36
  const legendX = W - 34 - legendW
  const legendY = originY + 7 * STEP + 30
  const swatchX = legendX + 38
  const legend = t.scale
    .map(
      (c, i) =>
        `      <rect x="${swatchX + i * STEP}" y="${legendY - 11}" width="${CELL}" height="${CELL}" rx="3.5" fill="${c}"/>`,
    )
    .join('\n')

  const chips = [
    [`${totalContributions.toLocaleString('en-US')}`, 'contributions'],
    [`${cal.currentStreak}`, 'day current streak'],
    [`${cal.longestStreak}`, 'day longest streak'],
  ]
  let chipRow = ''
  let cx = originX - 28
  chips.forEach(([value, label], i) => {
    chipRow += `
    <g>${fadeIn(0.4 + i * 0.12)}
      <text x="${cx}" y="${legendY}" fill="${t.title}" font-size="16" font-weight="700">${value}</text>
      <text x="${cx + Math.round(textWidth(value, 16)) + 7}" y="${legendY}" fill="${t.faint}" font-size="13">${label}</text>
    </g>`
    cx += Math.round(textWidth(value, 16)) + 14 + Math.round(textWidth(label, 13)) + 26
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${totalContributions} contributions by ${USER} in the last year" font-family="${FONT}">
${chrome(t, W, H, id)}
${heading(t, id, 40, 58, 'Contributions in the last year')}${months}
${dayLabels}
    <g>${grid}
    </g>${chipRow}
    <g>
      <text x="${legendX}" y="${legendY}" fill="${t.faint}" font-size="12">Less</text>
${legend}
      <text x="${swatchX + 5 * STEP + 4}" y="${legendY}" fill="${t.faint}" font-size="12">More</text>
    </g>
${frame(t, W, H)}
</svg>
`
}

/* -------------------------------------------------------------------- main */

const data = await fetchProfile()

for (const [name, theme] of Object.entries(THEMES)) {
  const id = name === 'dark' ? 'D' : 'L'
  await writeFile(join(OUT, `stats-${name}.svg`), statsCard(theme, id, data.stats))
  await writeFile(join(OUT, `langs-${name}.svg`), langsCard(theme, id, data.langs))
  await writeFile(join(OUT, `projects-${name}.svg`), projectsCard(theme, id, data.projects))
  await writeFile(
    join(OUT, `calendar-${name}.svg`),
    calendarCard(theme, id, data.calendar, data.stats.contributions),
  )
}

console.log(
  `✔ cards generated — ${data.stats.commits} commits, ${data.stats.stars} stars, ` +
    `${data.langs.length} languages, ${data.projects.length} featured projects, ` +
    `${data.stats.contributions} contributions (streak ${data.calendar.currentStreak}d, best ${data.calendar.longestStreak}d)`,
)
