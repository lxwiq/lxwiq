#!/usr/bin/env node
/**
 * Generates the SVG cards used by README.md straight from the GitHub API,
 * so the profile never depends on a third-party stats service being up.
 *
 *   GITHUB_TOKEN=... node scripts/generate-cards.mjs
 *
 * Cards are drawn with Primer tokens (GitHub's own design system) on a
 * transparent background, so they read as native GitHub UI in either theme.
 *
 * Outputs assets/{stats,langs,projects,calendar}-{dark,light}.svg
 */

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const USER = process.env.PROFILE_USER ?? 'lxwiq'
const TOKEN = process.env.GITHUB_TOKEN
// Public repos only — the workflow token cannot see private ones, and a link
// to a private repo 404s for every visitor.
const FEATURED = ['AudioSort', 'palworld-wine-egg', 'soundground', 'jellyseerr-bulk-manager']
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

/* ------------------------------------------------------------------ theme */

// Primer colour tokens, straight from GitHub's light/dark defaults.
const THEMES = {
  dark: {
    fg: '#f0f6fc',
    muted: '#9198a1',
    faint: '#656c76',
    border: '#3d444d',
    link: '#4493f8',
    accent: '#e3b341',
    track: '#2a3038',
    tile: '#151b23',
    tileOpacity: 0.5,
    // Contribution ramp in Primer yellow — the profile's Baguetoast accent.
    scale: ['#151b23', '#4d2d00', '#9e6a03', '#d29922', '#f2cc60'],
  },
  light: {
    fg: '#1f2328',
    muted: '#59636e',
    faint: '#818b98',
    border: '#d1d9e0',
    link: '#0969da',
    accent: '#9a6700',
    track: '#eff2f5',
    tile: '#f6f8fa',
    tileOpacity: 0.7,
    scale: ['#eff2f5', '#f8e3a1', '#e3b341', '#bb8009', '#7d4e00'],
  },
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"

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

  const projects = FEATURED.map((name) => repos.find((r) => r.name === name)).filter(Boolean)
  for (const name of FEATURED) {
    if (!projects.some((r) => r.name === name)) {
      console.warn(`⚠ featured repo "${name}" not visible to this token — dropped from the card`)
    }
  }

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
    projects,
  }
}

/* ----------------------------------------------------------------- svg kit */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])

const num = (n) => n.toLocaleString('en-US')

// Helvetica advance widths (AFM units, 1/1000 em). The rendered font is
// whatever the viewer has, but Helvetica metrics track the -apple-system /
// Segoe UI / Arial stack closely enough to wrap and truncate without clipping.
const ADVANCE = (() => {
  const m = {}
  const put = (chars, w) => {
    for (const ch of chars) m[ch] = w
  }
  put(' ', 278)
  put('!', 278); put('"', 355); put('#', 556); put('$', 556); put('%', 889); put('&', 667)
  put("'", 191); put('(', 333); put(')', 333); put('*', 389); put('+', 584); put(',', 278)
  put('-', 333); put('.', 278); put('/', 278); put('0123456789', 556); put(':', 278)
  put(';', 278); put('<', 584); put('=', 584); put('>', 584); put('?', 556); put('@', 1015)
  put('A', 667); put('B', 667); put('C', 722); put('D', 722); put('E', 667); put('F', 611)
  put('G', 778); put('H', 722); put('I', 278); put('J', 500); put('K', 667); put('L', 556)
  put('M', 833); put('N', 722); put('O', 778); put('P', 667); put('Q', 778); put('R', 722)
  put('S', 667); put('T', 611); put('U', 722); put('V', 667); put('W', 944); put('X', 667)
  put('Y', 667); put('Z', 611)
  put('[', 278); put('\\', 278); put(']', 278); put('^', 469); put('_', 556); put('`', 333)
  put('a', 556); put('b', 556); put('c', 500); put('d', 556); put('e', 556); put('f', 278)
  put('g', 556); put('h', 556); put('i', 222); put('j', 222); put('k', 500); put('l', 222)
  put('m', 833); put('n', 556); put('o', 556); put('p', 556); put('q', 556); put('r', 333)
  put('s', 500); put('t', 278); put('u', 556); put('v', 500); put('w', 722); put('x', 500)
  put('y', 500); put('z', 500)
  put('{', 334); put('|', 260); put('}', 334); put('~', 584)
  return m
})()

/**
 * Advance width in user units. `bold` covers the 600-weight text; the 1.05
 * safety factor absorbs the difference between Helvetica metrics and the
 * slightly wider faces the stack actually resolves to (SF Pro, Segoe UI).
 */
function textWidth(str, size, bold = false) {
  let units = 0
  for (const ch of String(str)) units += ADVANCE[ch] ?? 556
  return (units / 1000) * size * (bold ? 1.07 : 1) * 1.05
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

const svgOpen = (w, h, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}" font-family="${FONT}">`

/** Transparent card with a single Primer hairline — the whole chrome. */
const card = (t, w, h) =>
  `  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="none" stroke="${t.border}"/>`

const title = (t, x, y, text) =>
  `  <text x="${x}" y="${y}" fill="${t.fg}" font-size="15" font-weight="600">${esc(text)}</text>`

const eyebrow = (t, x, y, text) =>
  `  <text x="${x}" y="${y}" fill="${t.faint}" font-size="10.5" font-weight="600" letter-spacing="0.9">${esc(text)}</text>`

// Octicons, 16×16.
const ICONS = {
  star: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z',
  fork: 'M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z',
  repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z',
}

const icon = (name, x, y, size, fill) =>
  `<path d="${ICONS[name]}" fill="${fill}" transform="translate(${x} ${y}) scale(${size / 16})"/>`

/* -------------------------------------------------------------- stats card */

const STATS_W = 520
const STATS_H = 262

function statsCard(t, stats) {
  const groups = [
    [
      'LAST 12 MONTHS',
      [
        ['Commits', stats.commits],
        ['Pull requests', stats.prs],
        ['Reviews', stats.reviews],
        ['Contributions', stats.contributions],
      ],
    ],
    [
      'ALL TIME',
      [
        ['Repositories', stats.repos],
        ['Stars earned', stats.stars],
        ['Followers', stats.followers],
        ['Following', stats.following],
      ],
    ],
  ]

  let body = ''
  groups.forEach(([label, tiles], g) => {
    const top = 92 + g * 88
    body += `\n${eyebrow(t, 24, top, label)}`
    tiles.forEach(([name, value], i) => {
      const x = 24 + i * 118
      body += `
  <text x="${x}" y="${top + 34}" fill="${t.fg}" font-size="24" font-weight="600">${num(value)}</text>
  <text x="${x}" y="${top + 54}" fill="${t.muted}" font-size="11.5">${esc(truncate(name, 11.5, 110))}</text>`
    })
  })

  return `${svgOpen(STATS_W, STATS_H, `GitHub statistics for ${USER}`)}
${card(t, STATS_W, STATS_H)}
${title(t, 24, 40, 'GitHub stats')}
  <text x="24" y="60" fill="${t.muted}" font-size="12.5">Pulled from the GitHub API, refreshed daily</text>${body}
</svg>
`
}

/* --------------------------------------------------------------- langs card */

function langsCard(t, langs) {
  const W = STATS_W
  const H = STATS_H
  const barX = 24
  const barW = W - 48
  const barY = 76

  let bar = ''
  let cursor = barX
  for (const l of langs) {
    const w = Math.max((l.share / 100) * barW, 2)
    bar += `
      <rect x="${cursor.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="10" fill="${l.color}"/>`
    cursor += w
  }

  let legend = ''
  langs.forEach((l, i) => {
    const col = i % 2
    const row = (i - col) / 2
    const x = 24 + col * 240
    const y = 122 + row * 32
    legend += `
  <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>
  <text x="${x + 18}" y="${y}" fill="${t.fg}" font-size="12.5">${esc(truncate(l.name, 12.5, 128))}</text>
  <text x="${x + 206}" y="${y}" fill="${t.muted}" font-size="12.5" text-anchor="end">${l.share.toFixed(1)}%</text>`
  })

  return `${svgOpen(W, H, `Most used languages by ${USER}`)}
  <defs>
    <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5"/></clipPath>
  </defs>
${card(t, W, H)}
${title(t, 24, 40, 'Most used languages')}
  <rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5" fill="${t.track}"/>
  <g clip-path="url(#bar)">${bar}
  </g>${legend}
</svg>
`
}

/* ------------------------------------------------------------ projects card */

function projectsCard(t, projects) {
  const TILE_W = 512
  const TILE_H = 142
  const GAP = 16
  const W = TILE_W * 2 + GAP
  const rows = Math.ceil(projects.length / 2)
  const H = rows * TILE_H + (rows - 1) * GAP

  let body = ''
  projects.forEach((p, i) => {
    const col = i % 2
    const row = (i - col) / 2
    const x = col * (TILE_W + GAP)
    const y = row * (TILE_H + GAP)
    const pad = 20
    const lang = p.primaryLanguage

    const desc = wrap(p.description ?? '', 12.5, TILE_W - pad * 2, 2)
      .map((line, j) => `  <text x="${x + pad}" y="${y + 74 + j * 19}" fill="${t.muted}" font-size="12.5">${esc(line)}</text>`)
      .join('\n')

    // Footer runs left to right: language, stars, forks — each measured, not guessed.
    let fx = x + pad
    const fy = y + TILE_H - 22
    let footer = ''
    if (lang) {
      footer += `\n  <circle cx="${fx + 5}" cy="${fy - 4}" r="5" fill="${lang.color ?? t.accent}"/>
  <text x="${fx + 17}" y="${fy}" fill="${t.muted}" font-size="12">${esc(lang.name)}</text>`
      fx += 17 + Math.round(textWidth(lang.name, 12)) + 18
    }
    for (const [name, value] of [
      ['star', p.stargazerCount],
      ['fork', p.forkCount],
    ]) {
      footer += `\n  ${icon(name, fx, fy - 12, 14, t.muted)}
  <text x="${fx + 19}" y="${fy}" fill="${t.muted}" font-size="12">${num(value)}</text>`
      fx += 19 + Math.round(textWidth(String(value), 12)) + 18
    }

    body += `
  <rect x="${x + 0.5}" y="${y + 0.5}" width="${TILE_W - 1}" height="${TILE_H - 1}" rx="12" fill="${t.tile}" fill-opacity="${t.tileOpacity}" stroke="${t.border}"/>
  ${icon('repo', x + pad, y + 30, 16, t.muted)}
  <text x="${x + pad + 24}" y="${y + 43}" fill="${t.link}" font-size="15" font-weight="600">${esc(truncate(p.name, 15, TILE_W - pad * 2 - 24))}</text>
${desc}${footer}`
  })

  return `${svgOpen(W, H, `Featured projects by ${USER}`)}${body}
</svg>
`
}

/* ------------------------------------------------------------ calendar card */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function calendarCard(t, cal, totalContributions) {
  const CELL = 14
  const STEP = CELL + 4
  const originX = 58
  const originY = 92
  const W = originX + cal.weeks.length * STEP + 24
  const H = originY + 7 * STEP + 62

  const peak = Math.max(...cal.weeks.flat().map((d) => d.contributionCount), 1)
  const level = (n) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / peak) * 3.999)))

  let grid = ''
  let months = ''
  let lastMonth = -1
  cal.weeks.forEach((week, w) => {
    const month = Number(week[0].date.slice(5, 7)) - 1
    if (month !== lastMonth && w < cal.weeks.length - 2) {
      months += `\n  <text x="${originX + w * STEP}" y="${originY - 10}" fill="${t.muted}" font-size="11">${MONTHS[month]}</text>`
      lastMonth = month
    }
    for (const day of week) {
      grid += `
    <rect x="${originX + w * STEP}" y="${originY + day.weekday * STEP}" width="${CELL}" height="${CELL}" rx="3" fill="${t.scale[level(day.contributionCount)]}"/>`
    }
  })

  const dayLabels = [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ]
    .map(
      ([i, label]) =>
        `  <text x="${originX - 10}" y="${originY + i * STEP + 10}" fill="${t.muted}" font-size="11" text-anchor="end">${label}</text>`,
    )
    .join('\n')

  // Right-aligned "Less ▪▪▪▪▪ More", measured so it never clips the frame.
  const footY = originY + 7 * STEP + 32
  const moreX = W - 24 - Math.round(textWidth('More', 11))
  const swatchX = moreX - 6 - 5 * STEP
  const lessX = swatchX - 6 - Math.round(textWidth('Less', 11))
  const legend = t.scale
    .map(
      (c, i) =>
        `  <rect x="${swatchX + i * STEP}" y="${footY - 11}" width="${CELL}" height="${CELL}" rx="3" fill="${c}"/>`,
    )
    .join('\n')

  let chips = ''
  let cx = 24
  for (const [value, label] of [
    [num(cal.currentStreak), 'day streak'],
    [num(cal.longestStreak), 'day best'],
  ]) {
    chips += `
  <text x="${cx}" y="${footY}" fill="${t.fg}" font-size="12.5" font-weight="600">${value}</text>
  <text x="${cx + Math.round(textWidth(value, 12.5, true)) + 5}" y="${footY}" fill="${t.muted}" font-size="12.5">${label}</text>`
    cx += Math.round(textWidth(value, 12.5, true)) + 10 + Math.round(textWidth(label, 12.5)) + 22
  }

  return `${svgOpen(W, H, `${totalContributions} contributions by ${USER} in the last year`)}
${card(t, W, H)}
${title(t, 24, 40, `${num(totalContributions)} contributions in the last year`)}
  <text x="24" y="60" fill="${t.muted}" font-size="12.5">Public activity across every repository</text>${months}
${dayLabels}
  <g>${grid}
  </g>${chips}
${legend}
  <text x="${lessX}" y="${footY}" fill="${t.muted}" font-size="11">Less</text>
  <text x="${moreX}" y="${footY}" fill="${t.muted}" font-size="11">More</text>
</svg>
`
}

/* -------------------------------------------------------------------- main */

const data = await fetchProfile()

for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(OUT, `stats-${name}.svg`), statsCard(theme, data.stats))
  await writeFile(join(OUT, `langs-${name}.svg`), langsCard(theme, data.langs))
  await writeFile(join(OUT, `projects-${name}.svg`), projectsCard(theme, data.projects))
  await writeFile(
    join(OUT, `calendar-${name}.svg`),
    calendarCard(theme, data.calendar, data.stats.contributions),
  )
}

console.log(
  `✔ cards generated — ${data.stats.commits} commits, ${data.stats.stars} stars, ` +
    `${data.langs.length} languages, ${data.projects.length} featured projects, ` +
    `${data.stats.contributions} contributions (streak ${data.calendar.currentStreak}d, best ${data.calendar.longestStreak}d)`,
)
