/**
 * Driving the interview from outside the tab.
 *
 * The app interviews the user, and a gate is `Question[]` — data, not a screen.
 * That is what makes this possible at all: something that wants to operate the
 * app does not have to find a button, guess a selector or simulate a click. It
 * can read the gate as JSON and write an answer back by id, which is the same
 * contract `QuestionView` renders and the same one the unit tests drive. A
 * controller is therefore not a second implementation of the flow; it is
 * another reader of the one that already exists.
 *
 * Pure: types, validation, the snapshot, and the rules about what may be done
 * unattended. Every transport is elsewhere — a Playwright session in
 * `scripts/drive.mjs`, a repository in `platform/browser/control`.
 *
 * ## The two rules that are not negotiable
 *
 * **No credential travels this channel, in either direction.** The transcribe
 * gate asks for an Anthropic API key in an ordinary `text` question, so a
 * snapshot that echoed the answers verbatim would put the user's key into
 * whatever carries this protocol — a file in a repository, a log, a prompt.
 * That is the mistake `platform/browser/shelf` exists to make impossible for
 * the shelf token, and it is no more acceptable here. `REDACTED_QUESTIONS`
 * names the questions this applies to, the snapshot omits their answers, and
 * `validate` refuses to *set* them. A key is typed by the person whose key it
 * is, into the browser it is stored in.
 *
 * **Nothing here may spend money unattended.** Almost every paid step already
 * makes that easy: pressing "continue" at the transcribe or annotate gate puts
 * up a quote and stops, so a controller can advance freely and *report the
 * price* rather than approve it. There is exactly one exception in the app and
 * it is deliberate — a leaf answered `redo` at the uncertainty gate is read
 * again the moment that gate is left, with no quote, because a person who
 * ticked "read this page again" has already decided. A controller has decided
 * nothing, so `advanceOutlook` refuses that one by name. This is a check on
 * *state*, not on anyone's good intentions: it is computed from the answers
 * about to be committed, and it is why the rule is here in core, where it is
 * tested, rather than in whichever transport happens to be running.
 */
import type { AnswerValue, Answers, Evidence, Question, StepId } from '@core/wizard'

/** Bump when a field changes meaning; both ends print it and can refuse. */
export const CONTROL_VERSION = 1

/** Where a control session's files live in the repository carrying them. */
export const CONTROL_ROOT = 'control'

/** The commands sent to the app, and what the app sends back. */
export function inboxPath(session: string): string {
  return `${CONTROL_ROOT}/${session}/inbox.json`
}

export function outboxPath(session: string): string {
  return `${CONTROL_ROOT}/${session}/outbox.json`
}

/**
 * A session name that cannot climb out of `control/`.
 *
 * The name reaches a path, and the path reaches a repository write. Anything
 * outside this alphabet — a slash, a dot pair — would let a control file be
 * written over a book.
 */
export function validSession(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name)
}

/**
 * Questions whose answer is a credential and must never be carried.
 *
 * A set rather than a convention, because the cost of forgetting is publishing
 * the user's API key. Anything added to the wizard that takes a secret belongs
 * here, and the test asserts the transcribe gate's key question is in it.
 */
export const REDACTED_QUESTIONS: ReadonlySet<string> = new Set(['apiKey'])

/** What a controller can ask for. */
export type Command =
  /** Describe the gate on screen. The only command with no effect at all. */
  | { op: 'state' }
  /** Set one answer on the current gate, by question id. */
  | { op: 'answer'; id: string; value: AnswerValue }
  /** Press the gate's forward button. */
  | { op: 'advance' }
  /**
   * Fetch the pixels behind a piece of evidence.
   *
   * The app's rule is that nobody decides blind, and a snapshot that carried
   * `blob:` URLs would break it in the worst way — an image reference that
   * resolves to nothing outside the tab that minted it looks like evidence and
   * is not. So the snapshot carries a `ref` instead, and this is how the ref
   * is turned back into the picture.
   */
  | { op: 'evidence'; ref: string }

/** One command, with the id its reply carries back. */
export interface CommandEnvelope {
  id: string
  command: Command
  /** When the controller wrote it. For the log a person reads, not for logic. */
  at?: string
}

export interface Inbox {
  version: number
  commands: CommandEnvelope[]
}

/**
 * What became of a command.
 *
 * `refused` is a first-class outcome rather than an error: a refusal is the
 * protocol working, and it says which rule applied so the controller can put
 * the decision to the person instead of retrying.
 */
export interface Reply {
  id: string
  at: string
  /**
   * `started` is written *before* a command runs and replaced by its result.
   *
   * Without it a tab that dies between executing a command and recording what
   * happened would come back, find the command unanswered, and run it again —
   * and the command it would re-run is `advance`, which is how a gate gets
   * left twice. The claim costs one extra write and turns an invisible double
   * action into a reply that says, in words, that the result is unknown. Same
   * rule as the batch ticket: record the thing that cannot be recovered before
   * doing the thing.
   */
  outcome: 'done' | 'refused' | 'failed' | 'started'
  /** Why, in words that name the thing to do about it. */
  reason?: string
  /** The gate as it stands after the command. Absent only when it failed. */
  view?: GateView
  /** Set by `evidence`. */
  image?: { mediaType: string; base64: string }
}

export interface Outbox {
  version: number
  replies: Reply[]
}

/** A piece of evidence, with the pixels named rather than inlined. */
export type ViewEvidence =
  { kind: 'text'; text: string; label?: string } | { kind: 'image'; alt: string; ref: string }

/** One question, flattened to what survives a wire. */
export interface ViewQuestion {
  id: string
  type: Question['type']
  prompt: string
  help?: string
  required?: boolean
  group?: string
  /** Absent on questions whose answer is a credential. */
  defaultValue?: AnswerValue
  options?: { value: string; label: string; description?: string }[]
  /**
   * The rows of a grid question — terms, disagreements, passages — trimmed to
   * what can be judged from here and carrying refs for their crops.
   */
  rows?: ViewRow[]
  evidence: ViewEvidence[]
  /** True when the answer is a credential: prompt shown, content withheld. */
  redacted?: boolean
}

/** A grid row, whatever grid it came from. */
export interface ViewRow {
  id: string
  /** The row's own words: the reading, the passage, the disagreement. */
  text: string
  /** What kind of thing it is, where the grid distinguishes them. */
  kind?: string
  /** Anything the grid shows beside it — counts, signals, pages. */
  notes?: string[]
  /** Crops, as refs. */
  images?: ViewEvidence[]
}

/** Whether the forward button can be pressed by something that is not a person. */
export interface AdvanceOutlook {
  /** True when advancing spends nothing and asks nobody for money. */
  unattended: boolean
  /** What pressing it does, said plainly. */
  effect: string
  /** Present when it may not be done unattended, and why. */
  refusal?: string
}

/** The gate on screen, as JSON. */
export interface GateView {
  version: number
  step: StepId
  title: string
  fileName: string | null
  /**
   * The scan's size in bytes, or 0 when no book is open.
   *
   * Carried beside the name because a name on its own does not identify a
   * book: two scans of the same title share one constantly, and a controller
   * matching on the name alone took an eight-leaf sample's page count for a
   * three-hundred-leaf book. Same rule as `keyMatchesFile`, which has said so
   * all along.
   */
  fileSize: number
  pageCount: number
  progress: { done: number; total: number; pct: number }
  questions: ViewQuestion[]
  /** The answers as they stand, credentials omitted. */
  answers: Answers
  /** Required questions still unanswered — what `advance` is waiting for. */
  missing: string[]
  advance: AdvanceOutlook
  /**
   * A stage that is running, named. A controller that cannot see this would
   * read a gate mid-OCR as an empty one and start answering the last book.
   */
  busy?: string
  error?: string
}

/**
 * What leaving this gate will do, and whether it may be done unattended.
 *
 * See the header: the transcribe and annotate gates *quote* rather than spend,
 * so they are allowed and their price is reported. The uncertainty gate is the
 * one place in the app where the forward button spends with no quote, and only
 * when a leaf has been marked for re-reading — so that is what is checked, on
 * the answers about to be committed rather than on the step alone. A gate with
 * no leaf marked `redo` is free and is allowed.
 */
export function advanceOutlook(step: StepId, answers: Answers): AdvanceOutlook {
  if (step === 'gate-uncertainties') {
    const redo = Object.entries(answers)
      .filter(([id, value]) => /^page-\d+$/.test(id) && value === 'redo')
      .map(([id]) => id)
    if (redo.length > 0) {
      const leaves = redo.length === 1 ? '1 leaf' : `${redo.length} leaves`
      return {
        unattended: false,
        effect: `Re-reads ${leaves} against the API.`,
        refusal:
          `${leaves} ${redo.length === 1 ? 'is' : 'are'} marked to be read again, ` +
          'and this gate re-reads them the moment it is left — with no cost approval, because ' +
          'a person who ticked "read this again" has already decided. Nothing here has. ' +
          'Either clear those answers, or have the person press the button.'
      }
    }
    return { unattended: true, effect: 'Applies the verdicts and moves on. Free.' }
  }
  if (step === 'transcribe') {
    // The same three branches the gate's own button distinguishes. Saying
    // "this will quote you" when the answer on screen is "use the reading I
    // already paid for" would have a controller reporting a price that is
    // never going to appear, and waiting for a person who has nothing to press.
    if (answers['batchAction'] === 'collect') {
      return { unattended: true, effect: 'Collects pages already submitted and billed. Free.' }
    }
    if (answers['useSavedRun'] === 'use') {
      return { unattended: true, effect: 'Uses the reading already paid for. Free.' }
    }
    return {
      unattended: true,
      effect:
        'Puts up the cost estimate and stops. Nothing is spent until a person presses the ' +
        'button that names the price.'
    }
  }
  if (step === 'annotate') {
    return {
      unattended: true,
      effect:
        'Quotes the notes and harvest passes and stops. Declining all of them is free and ' +
        'moves straight on; anything else waits for a person to approve the price.'
    }
  }
  if (step === 'export') {
    return { unattended: true, effect: 'Lays the book out and writes the PDF. Free.' }
  }
  return { unattended: true, effect: 'Records the answers and moves to the next step. Free.' }
}

/**
 * Read a command off the wire.
 *
 * The inbox is a file in a repository: everything in it is untrusted input, and
 * a malformed command must come back as a refusal rather than reach the wizard
 * as `undefined`. Returns the reason it was rejected rather than a bare null,
 * because "that command was not understood" is useless to whoever wrote it.
 */
export function parseCommand(raw: unknown): { command: Command } | { reason: string } {
  if (typeof raw !== 'object' || raw === null) return { reason: 'A command must be an object.' }
  const op = (raw as { op?: unknown }).op
  if (op === 'state') return { command: { op: 'state' } }
  if (op === 'advance') return { command: { op: 'advance' } }
  if (op === 'evidence') {
    const ref = (raw as { ref?: unknown }).ref
    if (typeof ref !== 'string' || ref.length === 0) {
      return { reason: 'An `evidence` command needs the `ref` a snapshot gave it.' }
    }
    return { command: { op: 'evidence', ref } }
  }
  if (op === 'answer') {
    const id = (raw as { id?: unknown }).id
    if (typeof id !== 'string' || id.length === 0) {
      return { reason: 'An `answer` command needs the question `id`.' }
    }
    if (REDACTED_QUESTIONS.has(id)) {
      return {
        reason:
          `“${id}” is a credential. It is typed by the person whose credential it is, into ` +
          'the browser that stores it — it does not travel this channel in either direction.'
      }
    }
    const value = validAnswer((raw as { value?: unknown }).value)
    if (value === null) {
      return {
        reason:
          'An answer must be a string, a boolean, an array of strings, or an object of ' +
          'string to string.'
      }
    }
    return { command: { op: 'answer', id, value } }
  }
  return { reason: `Unknown command “${String(op)}”.` }
}

/** The answer shapes the wizard accepts, checked to their leaves. */
function validAnswer(value: unknown): AnswerValue | null {
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === 'string') ? (value as string[]) : null
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.every(([, v]) => typeof v === 'string')) return null
    return Object.fromEntries(entries) as Record<string, string>
  }
  return null
}

/**
 * A crop of named words on a leaf, as a source resolved when it is asked for.
 *
 * A discrepancy row names OCR word ids rather than carrying a picture: the
 * picture is cut out of the page on demand, one render per leaf, and cutting
 * every crop in the book to build a snapshot would render the whole scan to
 * answer one question. So the reference travels and the pixels are fetched by
 * `evidence`, which is what makes a gate readable from outside the tab at the
 * cost of the one page it is actually about.
 *
 * The `words:` prefix follows the app's own `page:N` convention, where a piece
 * of evidence names what to draw rather than carrying it. One pseudo-scheme in
 * two shapes beats two mechanisms.
 */
export function wordsRef(pageIndex: number, tokenIds: readonly string[]): string {
  return `words:${pageIndex}:${tokenIds.join(',')}`
}

/** The other half of `wordsRef`, for whichever transport resolves the pixels. */
export function parseWordsRef(src: string): { pageIndex: number; tokenIds: string[] } | null {
  const m = /^words:(\d+):(.*)$/.exec(src)
  if (!m) return null
  const tokenIds = m[2]!.split(',').filter((s) => s.length > 0)
  return { pageIndex: Number(m[1]), tokenIds }
}

/** What a snapshot produced: the view, and where its pixels can be found. */
export interface Snapshot {
  view: GateView
  /**
   * `ref` → the source the app knows it by, usually an object URL.
   *
   * Kept beside the view rather than in it so the view stays a plain document
   * that can be written to a file, and so a URL that means nothing outside this
   * tab never leaves it.
   */
  images: Map<string, string>
}

export interface SnapshotInput {
  step: StepId
  title: string
  fileName: string | null
  fileSize?: number
  pageCount: number
  progress: { done: number; total: number; pct: number }
  questions: readonly Question[]
  answers: Answers
  missing: readonly string[]
  busy?: string
  error?: string | null
}

/**
 * The gate, flattened for a controller.
 *
 * Two things happen here and both are the point. Every image is replaced by a
 * `ref` — see the `evidence` command for why a `blob:` URL on the wire is worse
 * than no image at all. And every credential question is emptied of content
 * while keeping its prompt, so a controller can *say* that a key is being asked
 * for without being able to read or write one.
 */
export function snapshot(input: SnapshotInput): Snapshot {
  const images = new Map<string, string>()
  const questions = input.questions.map((q) => viewOfQuestion(q, images))
  const answers: Answers = {}
  for (const [id, value] of Object.entries(input.answers)) {
    if (REDACTED_QUESTIONS.has(id)) continue
    answers[id] = value
  }
  return {
    view: {
      version: CONTROL_VERSION,
      step: input.step,
      title: input.title,
      fileName: input.fileName,
      fileSize: input.fileSize ?? 0,
      pageCount: input.pageCount,
      progress: input.progress,
      questions,
      answers,
      missing: [...input.missing],
      advance: advanceOutlook(input.step, input.answers),
      ...(input.busy ? { busy: input.busy } : {}),
      ...(input.error ? { error: input.error } : {})
    },
    images
  }
}

/** Register one image and hand back the name the wire knows it by. */
function refFor(images: Map<string, string>, questionId: string, src: string): string {
  const ref = `${questionId}#${images.size}`
  images.set(ref, src)
  return ref
}

function viewOfEvidence(
  evidence: readonly Evidence[] | undefined,
  questionId: string,
  images: Map<string, string>
): ViewEvidence[] {
  const out: ViewEvidence[] = []
  for (const e of evidence ?? []) {
    if (e.kind === 'text') {
      out.push({ kind: 'text', text: e.text, ...(e.label ? { label: e.label } : {}) })
    } else if (e.kind === 'image') {
      out.push({ kind: 'image', alt: e.alt, ref: refFor(images, questionId, e.src) })
    } else {
      out.push({ kind: 'image', alt: e.caption, ref: refFor(images, questionId, e.src) })
    }
  }
  return out
}

function viewOfQuestion(q: Question, images: Map<string, string>): ViewQuestion {
  const base: ViewQuestion = {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    ...(q.help ? { help: q.help } : {}),
    ...(q.required ? { required: true } : {}),
    ...(q.group ? { group: q.group } : {}),
    evidence: viewOfEvidence(q.evidence, q.id, images)
  }
  if (REDACTED_QUESTIONS.has(q.id)) return { ...base, redacted: true, evidence: [] }

  switch (q.type) {
    case 'choice':
    case 'multi-choice':
      return {
        ...base,
        defaultValue: q.defaultValue,
        options: q.options.map((o) => ({
          value: o.value,
          label: o.label,
          ...(o.description ? { description: o.description } : {})
        }))
      }
    case 'text':
    case 'confirm':
      return { ...base, defaultValue: q.defaultValue }
    case 'term-grid':
      return {
        ...base,
        rows: q.rows.map((r) => ({
          id: r.id,
          text: r.reading,
          notes: [`${r.count}×`, ...r.signals, `pages ${r.pages.join(', ')}`],
          images: r.cropSrc
            ? [{ kind: 'image' as const, alt: r.reading, ref: refFor(images, q.id, r.cropSrc) }]
            : []
        }))
      }
    case 'page-edit':
      return {
        ...base,
        rows: q.rows.map((r) => ({
          id: r.id,
          text: r.text,
          kind: r.kind,
          notes:
            r.alsoFromPages.length > 0
              ? [`runs onto ${r.alsoFromPages.map((p) => p + 1).join(', ')}`]
              : []
        }))
      }
    case 'discrepancies':
      return {
        ...base,
        rows: q.rows.map((r) => {
          return {
            id: r.id,
            text: r.text,
            kind: r.strength,
            notes: [
              // The words either side, so the gap reads as a place in a
              // sentence rather than as a loose word.
              `…${r.after} [${r.text}] ${r.before}…`,
              `OCR confidence ${Math.round(r.confidence)}%`,
              // A second reading is a recommendation carrying the reading it
              // rests on — never a verdict on its own say-so (SPEC §4).
              ...(r.checked
                ? [
                    `second reading: ${r.checked.verdict} — “${r.checked.reading}” ${r.checked.note}`
                  ]
                : [])
            ],
            images:
              r.tokenIds.length > 0
                ? [
                    {
                      kind: 'image' as const,
                      alt: r.text,
                      ref: refFor(images, q.id, wordsRef(q.pageIndex, r.tokenIds))
                    }
                  ]
                : []
          }
        })
      }
    default:
      return base
  }
}
