import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROLES } from '@core/work'

/**
 * The team's agent definitions (`docs/specs/agent-roles.md`) stay in step
 * with the roles a status note may name (`src/core/work/vocab.ts`, which
 * `scripts/work.mjs` checks every note against) and with the rules the spec
 * sets: every role on Opus, an allowlist of tools with no way to start agents
 * of its own, no Edit tool for the two roles that only report, and links to
 * its own brief that lead somewhere real, anchors included. The tool list is
 * all this can hold a role to: what the checker and Etsu's editor do with
 * Write and Bash is set by their briefs (docs/process/README.md, "What a
 * definition locks"). The managing editor is the session and has no file.
 *
 * `problems` and `teamProblems` are the rules; the last block feeds them
 * made-up faulty input so a rule that stops catching its fault fails here,
 * not in a session.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AGENTS = join(ROOT, '.claude', 'agents')
const PROCESS = join(ROOT, 'docs', 'process')
const README = join(PROCESS, 'README.md')

const FIELDS = ['name', 'description', 'model', 'tools', 'color']
const REQUIRED = ['name', 'description', 'model', 'tools']
/**
 * Fields Claude Code documents that a definition does not use yet but may (a
 * hook guard, a turn limit): known, so adding one is not refused. Any of them
 * may hold an indented block, as `hooks` does.
 */
const LATER_WORDS = 'disallowedTools hooks permissionMode maxTurns skills effort memory isolation'
const LATER = LATER_WORDS.split(' ')
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']
/** Tools that start another agent: a role never spawns its own. */
const SPAWNING = ['Agent', 'Task']
/** Tools that change a file in place. */
const EDITING = ['Edit', 'MultiEdit', 'NotebookEdit']
/** The roles that report and never fix. */
const REPORT_ONLY = ['checker', 'etsu-editor']
/** The roles for changes to the tools, which read no book's process. */
const TOOLS_WORK = ['builder', 'reviewer']
/** What every book role links: how it works with the shelf, and the team's rules. */
const EVERY_BOOK_ROLE = ['docs/process/sessions.md', 'docs/process/README.md']
/** Each role's own brief, from the repository's root: its definition must link every one. */
const BRIEFS: Readonly<Record<string, readonly string[]>> = {
  scout: ['docs/process/sourcing.md'],
  reader: ['docs/process/reading.md'],
  checker: ['docs/process/checking.md'],
  typesetter: ['docs/process/export.md', 'docs/process/pictures.md'],
  etsu: ['docs/process/writing.md', 'docs/process/glossary.md'],
  'etsu-editor': ['docs/process/writing.md', 'docs/process/glossary.md'],
  builder: ['CLAUDE.md'],
  reviewer: ['CLAUDE.md']
}
const SESSION_ITSELF = 'managing-editor'
const ROLE_FILES: readonly string[] = ROLES.filter((r) => r !== SESSION_ITSELF)

/** A YAML value on one line, read as YAML reads it, or why it would not be. */
function scalar(value: string): { text: string } | { problem: string } {
  if (value.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/u.test(value))
      return { problem: 'is a quotation that does not close' }
    try {
      return { text: JSON.parse(value) as string }
    } catch {
      return { problem: 'holds an escape YAML may not read as meant' }
    }
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/u.test(value)) return { problem: 'is a quotation that does not close' }
    return { text: value.slice(1, -1).replace(/''/gu, "'") }
  }
  if (/^[-?:,[\]{}#&*!|>%@`]/u.test(value)) {
    return { problem: 'starts with a character YAML reads as syntax' }
  }
  if (value.includes(': ')) return { problem: 'holds ": ", which YAML reads as a new key' }
  if (value.includes(' #')) return { problem: 'holds " #", which YAML reads as a comment' }
  if (value !== value.trim()) return { problem: 'has spaces at an end' }
  return { text: value }
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, each space a hyphen. */
export function slug(heading: string): string {
  return heading
    .trim()
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[`*]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /gu, '-')
}

/** Every anchor a Markdown file's headings make, a repeated heading numbered as GitHub does. */
export function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>()
  const out = new Set<string>()
  const text = markdown.replace(/```[\s\S]*?```/gu, '')
  for (const [, heading] of text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gmu)) {
    const base = slug(heading ?? '')
    const n = seen.get(base) ?? 0
    out.add(n === 0 ? base : `${base}-${n}`)
    seen.set(base, n + 1)
  }
  return out
}

/** Everything wrong with one definition, as plain sentences; none means it is sound. */
export function problems(file: string, text: string): string[] {
  const out: string[] = []
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const close = lines.indexOf('---', 1)
  if (lines[0] !== '---' || close < 0) return [`${file}: no frontmatter between two "---" lines`]
  const fields = new Map<string, string>()
  let inBlock = false
  for (const [i, line] of lines.slice(1, close).entries()) {
    if (inBlock && /^[ \t]+\S/u.test(line)) continue
    inBlock = false
    const m = /^([a-zA-Z][\w-]*):(?: (.*))?$/u.exec(line)
    if (!m) {
      out.push(`${file}: frontmatter line ${i + 2} is not "key: value"`)
      continue
    }
    const key = m[1] ?? ''
    const value = m[2] ?? ''
    const known = FIELDS.includes(key) || LATER.includes(key)
    if (!known) out.push(`${file}: unknown field "${key}"`)
    if (fields.has(key)) out.push(`${file}: field "${key}" given twice`)
    if (value.length === 0) {
      if (LATER.includes(key)) inBlock = true
      else out.push(`${file}: field "${key}" is empty`)
      fields.set(key, '')
      continue
    }
    const read = scalar(value)
    if ('problem' in read) out.push(`${file}: field "${key}" ${read.problem}`)
    fields.set(key, 'text' in read ? read.text : value)
  }
  for (const key of REQUIRED) if (!fields.has(key)) out.push(`${file}: no "${key}" field`)

  const name = fields.get('name') ?? ''
  if (fields.has('name') && name !== file.replace(/\.md$/u, '')) {
    out.push(`${file}: name "${name}" is not the file's name`)
  }
  if (fields.has('name') && !ROLE_FILES.includes(name)) {
    out.push(
      `${file}: "${name}" is not a role scripts/work.mjs accepts (or it is the session's own)`
    )
  }
  if (fields.has('model') && fields.get('model') !== 'opus') out.push(`${file}: model is not opus`)
  const color = fields.get('color')
  if (color !== undefined && !COLORS.includes(color)) out.push(`${file}: no such color "${color}"`)

  const tools = (fields.get('tools') ?? '').split(',').map((t) => t.trim())
  for (const tool of fields.has('tools') ? tools : []) {
    if (!/^[A-Z][A-Za-z]*$/u.test(tool) && !/^mcp__[\w-]+__[\w-]+$/u.test(tool)) {
      out.push(`${file}: "${tool}" is not a plain tool name (patterns are not supported)`)
    }
    if (SPAWNING.includes(tool)) out.push(`${file}: ${tool} would let the role start agents`)
    if (REPORT_ONLY.includes(name) && EDITING.includes(tool)) {
      out.push(`${file}: ${tool} would let a role that only reports change a file`)
    }
  }
  if (new Set(tools).size !== tools.length) out.push(`${file}: a tool is listed twice`)

  const body = lines
    .slice(close + 1)
    .join('\n')
    .replace(/```[\s\S]*?```/gu, '')
  const linked = new Set<string>()
  for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/gu)) {
    const [path = '', anchor] = (target ?? '').split('#')
    if (path.includes('://') || path.startsWith('mailto:')) continue
    const full = path === '' ? null : resolve(AGENTS, path)
    if (full !== null && !existsSync(full)) {
      out.push(`${file}: links to missing "${path}"`)
      continue
    }
    if (full !== null) linked.add(full)
    if (anchor === undefined || anchor === '') continue
    const page = full === null ? body : full.endsWith('.md') ? readFileSync(full, 'utf8') : null
    if (page !== null && !anchors(page).has(anchor)) {
      const where = full === null ? file : relative(ROOT, full).split(sep).join('/')
      out.push(`${file}: links to "#${anchor}", which no heading in ${where} makes`)
    }
  }
  if (!fields.has('name')) return out
  const wanted = [...(TOOLS_WORK.includes(name) ? [] : EVERY_BOOK_ROLE), ...(BRIEFS[name] ?? [])]
  for (const path of wanted) {
    if (!linked.has(join(ROOT, path))) out.push(`${file}: no link to ${path}`)
  }
  return out
}

/** Everything wrong with the team table in docs/process/README.md's "The team". */
export function teamProblems(readme: string): string[] {
  const out: string[] = []
  const start = readme.indexOf('\n## The team\n')
  if (start < 0) return ['README: no "The team" section']
  const rest = readme.slice(start + 1)
  const end = rest.indexOf('\n## ')
  const section = end < 0 ? rest : rest.slice(0, end)
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split(/\s*\|\s*/u).slice(1, -1))
  const targets = (cell: string) =>
    [...cell.matchAll(/\]\(([^)#\s]+)/gu)].map(([, t]) => resolve(PROCESS, t ?? ''))
  if (!rows.some((r) => r[0] === 'managing editor')) {
    out.push('README: the team table has no row for the managing editor')
  }
  for (const role of ROLE_FILES) {
    const row = rows.find((r) => r[0] === `\`${role}\``)
    if (!row) {
      out.push(`README: the team table has no row for ${role}`)
      continue
    }
    if (!targets(row[1] ?? '').includes(join(AGENTS, `${role}.md`))) {
      out.push(`README: the ${role} row does not link .claude/agents/${role}.md`)
    }
    for (const brief of BRIEFS[role] ?? []) {
      if (!targets(row[2] ?? '').includes(join(ROOT, brief))) {
        out.push(`README: the ${role} row does not name its brief ${brief}`)
      }
    }
  }
  return out
}

const files = readdirSync(AGENTS).filter((f) => f.endsWith('.md'))

describe('the agent definitions in .claude/agents', () => {
  it.each(files)('%s is sound', (file) => {
    expect(problems(file, readFileSync(join(AGENTS, file), 'utf8'))).toEqual([])
  })

  it('every role but the managing editor has a definition, and the managing editor none', () => {
    const missing = ROLE_FILES.filter((role) => !files.includes(`${role}.md`))
    expect(missing).toEqual([])
    expect(files).not.toContain(`${SESSION_ITSELF}.md`)
  })

  it("names each role's brief, and each brief is a file", () => {
    expect(Object.keys(BRIEFS).sort()).toEqual([...ROLE_FILES].sort())
    for (const path of Object.values(BRIEFS).flat()) expect(existsSync(join(ROOT, path))).toBe(true)
  })

  it("the README's team table names every role, its definition and its brief", () => {
    expect(teamProblems(readFileSync(README, 'utf8'))).toEqual([])
  })
})

describe('the rules catch a faulty definition', () => {
  const CHECKS = 'checks-that-must-pass-the-full-list-for-checked-and-ready-to-upload'
  const sound = [
    '---',
    'name: checker',
    'description: Checks made-up things, and only reports.',
    'model: opus',
    'tools: Read, Write, Bash, Grep, Glob',
    'color: red',
    '---',
    '',
    '## Its brief',
    '',
    'Read [docs/process/sessions.md](../../docs/process/sessions.md),',
    '[the rules](../../docs/process/README.md#rules-for-every-role) and',
    `[docs/process/checking.md](../../docs/process/checking.md#${CHECKS}).`,
    'See [above](#its-brief).',
    ''
  ].join('\n')
  const faulty = (from: string, to: string, file = 'checker.md') => {
    expect(sound).toContain(from)
    return problems(file, sound.replace(from, to)).join('\n')
  }

  it('passes the sound one, a quoted description and a hook block', () => {
    expect(problems('checker.md', sound)).toEqual([])
    const quoted = 'description: "Checks made-up things: it only reports, \\"never\\" fixes."'
    expect(faulty('description: Checks made-up things, and only reports.', quoted)).toBe('')
    const single = "description: 'It only reports: it''s the gate.'"
    expect(faulty('description: Checks made-up things, and only reports.', single)).toBe('')
    const guard = [
      'color: red',
      'maxTurns: 40',
      'hooks:',
      '  PreToolUse:',
      '    - matcher: Bash',
      '      hooks:',
      '        - type: command',
      '          command: node scripts/made-up-guard.mjs'
    ].join('\n')
    expect(faulty('color: red', guard)).toBe('')
  })

  it('catches each fault', () => {
    expect(problems('checker.md', sound.replace('---\n', ''))).toEqual([
      'checker.md: no frontmatter between two "---" lines'
    ])
    expect(faulty('model: opus', 'model: sonnet')).toMatch(/model is not opus/u)
    expect(faulty('model: opus', 'model: "sonnet"')).toMatch(/model is not opus/u)
    expect(faulty('model: opus\n', '')).toMatch(/no "model" field/u)
    expect(faulty('name: checker', 'name: checker', 'reader.md')).toMatch(/not the file's name/u)
    expect(faulty('name: checker', 'name: editor', 'editor.md')).toMatch(/not a role/u)
    expect(faulty('name: checker', 'name: managing-editor', 'managing-editor.md')).toMatch(
      /not a role/u
    )
    expect(faulty('Glob', 'Glob, Agent')).toMatch(/Agent would let the role start agents/u)
    expect(faulty('Glob', 'Glob, Task')).toMatch(/Task would let the role start agents/u)
    expect(faulty('Bash,', 'Bash(git status:*),')).toMatch(/not a plain tool name/u)
    expect(faulty('Write,', 'Write, Edit,')).toMatch(/Edit would let a role that only reports/u)
    expect(faulty('Write,', 'Write, Write,')).toMatch(/listed twice/u)
    expect(faulty('only reports.', 'only reports: never fixes.')).toMatch(
      /YAML reads as a new key/u
    )
    expect(faulty('description: Checks', 'description: "Checks')).toMatch(/does not close/u)
    expect(faulty('description: Checks', "description: 'Checks")).toMatch(/does not close/u)
    expect(faulty('color: red', 'colour: red')).toMatch(/unknown field "colour"/u)
    expect(faulty('color: red', 'colour:\n  shade: red')).toMatch(/unknown field "colour"/u)
    expect(faulty('color: red', 'color:\n  shade: red')).toMatch(/field "color" is empty/u)
    expect(faulty('color: red', 'color: gold')).toMatch(/no such color/u)
    expect(faulty('checking.md#', 'nothing-here.md#')).toMatch(/links to missing/u)
    expect(faulty('#rules-for-every-role', '#rules-for-each-role')).toMatch(
      /"#rules-for-each-role", which no heading in docs\/process\/README\.md makes/u
    )
    expect(
      faulty('#checks-that-must-pass-the-full-list', '#checks-that-must-pass-the-whole-list')
    ).toMatch(/which no heading in docs\/process\/checking\.md makes/u)
    expect(faulty('(#its-brief)', '(#its-briefs)')).toMatch(/which no heading in checker\.md/u)
    expect(faulty('process/sessions.md)', 'product.md)')).toMatch(
      /no link to docs\/process\/sessions\.md/u
    )
    expect(faulty('process/README.md#', 'product.md#')).toMatch(
      /no link to docs\/process\/README\.md/u
    )
    expect(faulty('process/checking.md#', 'process/reading.md#')).toMatch(
      /no link to docs\/process\/checking\.md/u
    )
  })

  it('holds each role to its own brief, and lets an editing role edit', () => {
    const typesetter = sound
      .replace('name: checker', 'name: typesetter')
      .replace('Write,', 'Write, Edit,')
      .replace(`docs/process/checking.md#${CHECKS}`, 'docs/process/export.md#steps')
    expect(problems('typesetter.md', typesetter)).toEqual([
      'typesetter.md: no link to docs/process/pictures.md'
    ])
    expect(
      problems('typesetter.md', `${typesetter}[pictures](../../docs/process/pictures.md)\n`)
    ).toEqual([])
    expect(problems('builder.md', sound.replace('name: checker', 'name: builder'))).toEqual([
      'builder.md: no link to CLAUDE.md'
    ])
  })

  it('catches a team table that leaves a role out or loses a link', () => {
    const readme = readFileSync(README, 'utf8')
    const row = (role: string) => {
      const line = readme.split('\n').find((l) => l.startsWith(`| \`${role}\``))
      expect(line).toBeDefined()
      return `${line}\n`
    }
    expect(teamProblems(readme.replace(row('reviewer'), ''))).toEqual([
      'README: the team table has no row for reviewer'
    ])
    expect(teamProblems(readme.replace('(../../.claude/agents/scout.md)', '(./scout.md)'))).toEqual(
      ['README: the scout row does not link .claude/agents/scout.md']
    )
    const typesetter = row('typesetter')
    expect(
      teamProblems(
        readme.replace(typesetter, typesetter.replace('[pictures.md](./pictures.md)', 'pictures'))
      )
    ).toEqual(['README: the typesetter row does not name its brief docs/process/pictures.md'])
    expect(teamProblems(readme.replace('| managing editor |', '| the session |'))).toEqual([
      'README: the team table has no row for the managing editor'
    ])
    expect(teamProblems(readme.replace('## The team', '## Who does what'))).toEqual([
      'README: no "The team" section'
    ])
  })

  it('makes the anchors GitHub makes', () => {
    const heading = 'Checks that must pass: the full list for "checked" and "ready to upload"'
    expect(slug(heading)).toBe(CHECKS)
    expect(slug('The team (the `managing` editor)')).toBe('the-team-the-managing-editor')
    expect([...anchors('# A\n## B\n```\n# Not one\n```\n## B\n')]).toEqual(['a', 'b', 'b-1'])
  })
})
