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
 * of its own, no editing for the two roles that only report, and a brief that
 * exists. The managing editor is the chat session itself and has no file.
 *
 * `problems` is the rule; the last block feeds it made-up faulty definitions
 * so a rule that stops catching its fault fails here, not in a session.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const AGENTS = join(ROOT, '.claude', 'agents')
const PROCESS = join(ROOT, 'docs', 'process')

const FIELDS = ['name', 'description', 'model', 'tools', 'color']
const REQUIRED = ['name', 'description', 'model', 'tools']
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']
/** Tools that start another agent: a role never spawns its own. */
const SPAWNING = ['Agent', 'Task']
/** Tools that change a file in place. */
const EDITING = ['Edit', 'MultiEdit', 'NotebookEdit']
/** The roles that report and never fix. */
const REPORT_ONLY = ['checker', 'etsu-editor']
/** The roles for changes to the tools, whose brief is the root CLAUDE.md. */
const TOOLS_WORK = ['builder', 'reviewer']
const SESSION_ITSELF = 'managing-editor'
const ROLE_FILES: readonly string[] = ROLES.filter((r) => r !== SESSION_ITSELF)

/** A YAML plain value that parses as the text it shows. */
function plainProblem(value: string): string | null {
  if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(value)) return 'starts with a character YAML reads as syntax'
  if (value.includes(': ')) return 'holds ": ", which YAML reads as a new key'
  if (value.includes(' #')) return 'holds " #", which YAML reads as a comment'
  if (value !== value.trim()) return 'has spaces at an end'
  return null
}

/** Everything wrong with one definition, as plain sentences; none means it is sound. */
export function problems(file: string, text: string): string[] {
  const out: string[] = []
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const close = lines.indexOf('---', 1)
  if (lines[0] !== '---' || close < 0) return [`${file}: no frontmatter between two "---" lines`]
  const fields = new Map<string, string>()
  for (const [i, line] of lines.slice(1, close).entries()) {
    const m = /^([a-z][\w-]*): (.*)$/u.exec(line)
    if (!m) {
      out.push(`${file}: frontmatter line ${i + 2} is not "key: value"`)
      continue
    }
    const [, key, value] = m as unknown as [string, string, string]
    if (!FIELDS.includes(key)) out.push(`${file}: unknown field "${key}"`)
    if (fields.has(key)) out.push(`${file}: field "${key}" given twice`)
    const why = value.length === 0 ? 'is empty' : plainProblem(value)
    if (why) out.push(`${file}: field "${key}" ${why}`)
    fields.set(key, value)
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
    const path = (target ?? '').split('#')[0] ?? ''
    if (path === '' || path.includes('://') || path.startsWith('mailto:')) continue
    const full = resolve(AGENTS, path)
    if (!existsSync(full)) out.push(`${file}: links to missing "${path}"`)
    else linked.add(full)
  }
  const briefs = [...linked].filter((p) => relative(PROCESS, p).split(sep).length === 1)
  if (TOOLS_WORK.includes(name)) {
    if (!linked.has(join(ROOT, 'CLAUDE.md'))) out.push(`${file}: no link to the root CLAUDE.md`)
  } else if (fields.has('name')) {
    if (!linked.has(join(PROCESS, 'sessions.md'))) {
      out.push(`${file}: no link to docs/process/sessions.md`)
    }
    if (!briefs.some((p) => !p.endsWith(`${sep}sessions.md`) && p.endsWith('.md'))) {
      out.push(`${file}: no link to its process document in docs/process/`)
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
})

describe('the rules catch a faulty definition', () => {
  const sound = [
    '---',
    'name: checker',
    'description: Checks made-up things, and only reports.',
    'model: opus',
    'tools: Read, Write, Bash, Grep, Glob',
    'color: red',
    '---',
    '',
    'Read [sessions](../../docs/process/sessions.md) and',
    '[checking](../../docs/process/checking.md#checks-that-must-pass).',
    ''
  ].join('\n')
  const faulty = (from: string, to: string, file = 'checker.md') => {
    expect(sound).toContain(from)
    return problems(file, sound.replace(from, to)).join('\n')
  }

  it('passes the sound one', () => {
    expect(problems('checker.md', sound)).toEqual([])
  })

  it('catches each fault', () => {
    expect(problems('checker.md', sound.replace('---\n', ''))).toEqual([
      'checker.md: no frontmatter between two "---" lines'
    ])
    expect(faulty('model: opus', 'model: sonnet')).toMatch(/model is not opus/u)
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
    expect(faulty('color: red', 'colour: red')).toMatch(/unknown field "colour"/u)
    expect(faulty('color: red', 'color: gold')).toMatch(/no such color/u)
    expect(faulty('checking.md#', 'nothing-here.md#')).toMatch(/links to missing/u)
    expect(faulty('process/sessions.md', 'product.md')).toMatch(
      /no link to docs\/process\/sessions/u
    )
    expect(faulty('process/checking.md', 'product.md')).toMatch(/no link to its process document/u)
  })

  it('lets an editing role edit, and holds the tools roles to the root CLAUDE.md', () => {
    const typesetter = sound
      .replace('name: checker', 'name: typesetter')
      .replace('Write,', 'Write, Edit,')
    expect(problems('typesetter.md', typesetter)).toEqual([])
    expect(problems('builder.md', sound.replace('name: checker', 'name: builder'))).toEqual([
      'builder.md: no link to the root CLAUDE.md'
    ])
  })
})
