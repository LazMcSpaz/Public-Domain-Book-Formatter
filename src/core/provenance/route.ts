/**
 * Which stages of the reading apply to a book of a given shape.
 *
 * The process (`docs/PROCESS-reading.md`) is written for a scan, and every
 * book that is not one has been read by a session deciding, stage by stage,
 * which parts still make sense — a decision made well on _Patterns_ Vol. I
 * and then made again from scratch on Vol. II. This is that decision as data:
 * one route per shape, each stage marked as running or not with the reason,
 * so the flowchart in `docs/FLOW.md` is generated from here and a test holds
 * the two together. A doc beside the code is how the ledger went missing on
 * ten books; a doc generated from it cannot.
 *
 * What a route decides is only what the shape decides. The stages here are
 * the ones whose *applicability* turns on pixels or on where the text came
 * from; everything a book gets regardless — assembly, coherence, the sense
 * pass, the query gate, layout — is not listed, because a table that says
 * "yes" in every column is not a table.
 */
import type { BookShape } from './shape'

/** How the free reading is taken (Stage 1). */
export type Reading =
  /** Tesseract over the pixels. */
  | 'ocr'
  /** The file's own characters read straight out, with their boxes. */
  | 'text-layer'
  /** The text as the file hands it, already in blocks. */
  | 'as-given'

/** What may accept a reading — the only party allowed to turn a finding into an edit. */
export type Accepter = 'pixels' | 'a second digitisation' | 'the book itself'

export const STAGE_IDS = [
  'vet-terms',
  'draft',
  'page-cleanup',
  'second-reader',
  'crops',
  'concordance',
  'damage-gate',
  'set-structure'
] as const
export type StageId = (typeof STAGE_IDS)[number]

export interface Stage {
  id: StageId
  /** How the process names it. */
  name: string
  runs: boolean
  /** Why it runs, or why it does not, for this route. */
  why: string
}

export const ROUTE_KEYS = [
  'scan',
  'scan-with-layer',
  'converted-text',
  'typeset-text',
  'nothing-to-read'
] as const
export type RouteKey = (typeof ROUTE_KEYS)[number]

export interface Route {
  key: RouteKey
  name: string
  reading: Reading
  accepter: Accepter
  stages: Stage[]
}

const STAGE_NAMES: Record<StageId, string> = {
  'vet-terms': 'Vet the harvested terms (Gate 1)',
  draft: 'Draft each leaf from its geometry, correct it against the leaf (Stages 2–3)',
  'page-cleanup': 'Clean the page image before OCR',
  'second-reader': 'A second OCR reader, compared word for word',
  crops: 'Adjudicate every finding against a crop (Stage 8)',
  concordance: 'Adjudicate against the book itself, with a query where it cannot answer (Stage 8b)',
  'damage-gate': 'Sweep for conversion damage, and refuse an export that carries it (Stage 6b)',
  'set-structure': 'Set heading levels and lost line breaks by hand'
}

/** Which route a shape takes. */
export function routeKey(s: BookShape): RouteKey {
  if (s.pixels) return s.textLayer === 'none' ? 'scan' : 'scan-with-layer'
  if (s.textLayer === 'typeset') return 'typeset-text'
  if (s.textLayer === 'converted') return 'converted-text'
  return 'nothing-to-read'
}

/** The route for a key, fully spelled out. */
export function routeByKey(key: RouteKey): Route {
  const stage = (id: StageId, runs: boolean, why: string): Stage => ({
    id,
    name: STAGE_NAMES[id],
    runs,
    why
  })

  switch (key) {
    case 'scan':
      return {
        key,
        name: 'A scan with no text layer',
        reading: 'ocr',
        accepter: 'pixels',
        stages: [
          stage('vet-terms', true, 'OCR read the words, so what it read is worth vetting'),
          stage('draft', true, 'the leaf is the witness; the draft is what it is checked against'),
          stage('page-cleanup', true, 'the pixels are what OCR reads, and what cleaning improves'),
          stage('second-reader', true, 'a second OCR shares no blind spot with the first'),
          stage('crops', true, 'a crop of the paper is the only accepter'),
          stage('concordance', false, 'the paper answers; the book need not stand in for it'),
          stage('damage-gate', true, 'free, and what it finds is settled against the leaf'),
          stage('set-structure', false, 'the draft measures levels and breaks off the leaf')
        ]
      }
    case 'scan-with-layer':
      return {
        key,
        name: "A scan carrying somebody's OCR layer",
        reading: 'ocr',
        accepter: 'pixels',
        stages: [
          stage('vet-terms', true, 'OCR read the words, so what it read is worth vetting'),
          stage('draft', true, 'the leaf is the witness; the draft is what it is checked against'),
          stage('page-cleanup', true, 'the pixels are what OCR reads, and what cleaning improves'),
          stage(
            'second-reader',
            true,
            'the file’s own layer is already a second digitisation — compare against it first'
          ),
          stage('crops', true, 'a crop of the paper is the only accepter'),
          stage('concordance', false, 'the paper answers; the book need not stand in for it'),
          stage('damage-gate', true, 'free, and what it finds is settled against the leaf'),
          stage('set-structure', false, 'the draft measures levels and breaks off the leaf')
        ]
      }
    case 'converted-text':
      return {
        key,
        name: "Somebody's OCR with no pixels behind it",
        reading: 'text-layer',
        accepter: 'the book itself',
        stages: [
          stage('vet-terms', false, 'nothing here read the words, so there is nothing to vet'),
          stage(
            'draft',
            false,
            'a render of such a leaf is the text layer drawn again — not a witness'
          ),
          stage('page-cleanup', false, 'there is no page image to clean'),
          stage('second-reader', false, 'no pixels for a second reader to read'),
          stage('crops', false, 'a crop is the hypothesis shown back to the adjudicator; refused'),
          stage(
            'concordance',
            true,
            'the book’s own vocabulary and repeated passages are the only witness; a place they cannot settle is raised as a query'
          ),
          stage(
            'damage-gate',
            true,
            'the words are shaped like right ones and this is what catches them'
          ),
          stage(
            'set-structure',
            true,
            'a text layer carries neither heading levels nor line breaks'
          )
        ]
      }
    case 'typeset-text':
      return {
        key,
        name: 'Typeset text, no page images',
        reading: 'as-given',
        accepter: 'the book itself',
        stages: [
          stage('vet-terms', false, 'nothing here read the words, so there is nothing to vet'),
          stage('draft', false, 'the text arrives in blocks already'),
          stage('page-cleanup', false, 'there is no page image to clean'),
          stage('second-reader', false, 'no pixels for a second reader to read'),
          stage('crops', false, 'no paper to crop'),
          stage(
            'concordance',
            true,
            'a finding still needs a witness, and the book is the one there is'
          ),
          stage(
            'damage-gate',
            true,
            'free; expected to find nothing, and a run that finds something says the shape is wrong'
          ),
          stage('set-structure', false, 'the file carries its own structure')
        ]
      }
    case 'nothing-to-read':
      return {
        key,
        name: 'Neither pixels nor text',
        reading: 'as-given',
        accepter: 'the book itself',
        stages: STAGE_IDS.map((id) =>
          stage(
            id,
            false,
            'the file has nothing to read; find the scan or the text and start again'
          )
        )
      }
  }
}

/** The route a book of this shape takes. */
export function routeFor(s: BookShape): Route {
  return routeByKey(routeKey(s))
}

/** Every route, in the order the flowchart lists them. */
export function allRoutes(): Route[] {
  return ROUTE_KEYS.map(routeByKey)
}

const MARK = { yes: '✓', no: '—' }

/**
 * The routes as markdown, for `docs/FLOW.md`.
 *
 * Generated rather than written so that the doc and the code cannot say two
 * different things; `test/provenance.test.ts` compares the doc's generated
 * section against this, and `scripts/shape.mjs --flow` rewrites it.
 */
export function routeTable(): string {
  const routes = allRoutes().filter((r) => r.key !== 'nothing-to-read')
  const lines: string[] = []

  lines.push('| | ' + routes.map((r) => `\`${r.key}\``).join(' | ') + ' |')
  lines.push('| --- | ' + routes.map(() => ':---:').join(' | ') + ' |')
  lines.push('| **What it is** | ' + routes.map((r) => r.name).join(' | ') + ' |')
  lines.push('| **The free reading** | ' + routes.map((r) => `\`${r.reading}\``).join(' | ') + ' |')
  lines.push('| **What accepts a reading** | ' + routes.map((r) => r.accepter).join(' | ') + ' |')
  for (const id of STAGE_IDS) {
    const cells = routes.map((r) => {
      const st = r.stages.find((x) => x.id === id)
      return st?.runs ? MARK.yes : MARK.no
    })
    lines.push(`| ${STAGE_NAMES[id]} | ${cells.join(' | ')} |`)
  }
  lines.push('')

  for (const r of routes) {
    lines.push(`### \`${r.key}\` — ${r.name}`)
    lines.push('')
    for (const st of r.stages) {
      lines.push(`- ${st.runs ? MARK.yes : MARK.no} **${st.name}** — ${st.why}`)
    }
    lines.push('')
  }
  const nothing = routeByKey('nothing-to-read')
  lines.push(`### \`${nothing.key}\` — ${nothing.name}`)
  lines.push('')
  lines.push(`- ${nothing.stages[0]?.why ?? ''}`)
  lines.push('')
  return lines.join('\n')
}

/** The markers the generated section of `docs/FLOW.md` sits between. */
export const FLOW_BEGIN =
  '<!-- routes:begin — generated by `node scripts/shape.mjs --flow`; do not edit by hand -->'
export const FLOW_END = '<!-- routes:end -->'

/** Put the generated table into the doc, keeping every other line. */
export function withRouteTable(doc: string): string {
  const begin = doc.indexOf(FLOW_BEGIN)
  const end = doc.indexOf(FLOW_END)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      'docs/FLOW.md has lost its route markers; the generated section has nowhere to go.'
    )
  }
  return `${doc.slice(0, begin + FLOW_BEGIN.length)}\n\n${routeTable()}\n${doc.slice(end)}`
}
