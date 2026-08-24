/**
 * One implementation of what a command does, for every transport that sends one.
 *
 * There are two ways to drive this app from outside: a Playwright session in
 * the sandbox (`scripts/drive.mjs`) and a repository the user owns
 * (`AgentBridge`). Neither of them may know how a gate works. If the driver
 * clicked buttons and the bridge set state, they would be two implementations
 * of the flow, they would disagree eventually, and the disagreement would show
 * up as a controller that works in the harness and not on a real book.
 *
 * So both send a `Command` and this is the only thing that executes one. It is
 * a thin layer over what `App` already does — the same `setAnswers` the
 * renderer calls, the same `advance` the button calls — plus the refusals from
 * `@core/control`, which is where they are tested.
 *
 * Browser-only, but deliberately not in `platform/`: it holds no browser API of
 * its own beyond fetching a Blob back out of an object URL, and it is bound to
 * `App`'s state rather than to the platform.
 */
import { useEffect, useRef } from 'react'
import { parseCommand, parseWordsRef, snapshot, type GateView, type Reply } from '@core/control'
import { toBase64 } from '@core/project'
import type { Answers, AnswerValue, Question, StepId } from '@core/wizard'

/** What a reply says, before the transport stamps it with the command's id. */
export type CommandOutcome = Omit<Reply, 'id' | 'at'>

export interface AgentSurfaceInput {
  step: StepId
  title: string
  fileName: string | null
  fileSize?: number
  pageCount: number
  progress: { done: number; total: number; pct: number }
  questions: Question[]
  answers: Answers
  missing: string[]
  /** A stage that is running, named — recon, a paid run, a build. */
  busy?: string
  error?: string | null
  setAnswer: (id: string, value: AnswerValue) => void
  advance: () => void
  resolveEvidence: (src: string) => string | undefined
  enlargeEvidence: (src: string) => Promise<string | undefined>
  cropWords: (
    pageIndex: number,
    groups: readonly { id: string; tokenIds: readonly string[] }[]
  ) => Promise<Map<string, string>>
}

export interface AgentSurface {
  view: () => GateView
  run: (raw: unknown) => Promise<CommandOutcome>
}

declare global {
  interface Window {
    /** Published in dev only; how `scripts/drive.mjs` talks to the app. */
    __pdbfAgent?: AgentSurface
  }
}

/**
 * Wait for the command's effect to land, not for a fixed number of frames.
 *
 * A reply has to describe the gate *after* the command, or a controller reads
 * back the state it just changed away from and sends the same command again.
 * The trouble is that "after" is not a fixed delay: setting an answer commits
 * on the next frame, while leaving a gate rebuilds the step, recomputes every
 * question from the new state and sometimes starts a stage — measurably more
 * than two frames on a real book.
 *
 * So the caller says what it is waiting for and this polls until that is true.
 * When it never becomes true the current state is returned anyway, which
 * is the honest answer: the command was sent, and this is what the app looks
 * like now. `setTimeout` rather than `requestAnimationFrame` alone because a
 * hidden tab fires no frames at all — which is exactly the state a phone with
 * the screen off is in, and the state this feature exists to be useful in.
 */
async function settleUntil(done: () => boolean, limitMs: number): Promise<void> {
  const deadline = Date.now() + limitMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 16))
    if (done()) return
  }
}

/** The bytes behind an object URL, as base64, with the URL left as it was found. */
async function imageAt(url: string): Promise<{ mediaType: string; base64: string }> {
  const res = await fetch(url)
  const blob = await res.blob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return { mediaType: blob.type || 'image/png', base64: toBase64(bytes) }
}

export function useAgentSurface(input: AgentSurfaceInput): AgentSurface {
  // Refreshed on every render, so `view()` and `run()` always read the gate as
  // it stands rather than the one that was on screen when the surface was
  // built. A surface captured in a poll loop's closure would otherwise answer
  // for a book two steps ago.
  const latest = useRef(input)
  latest.current = input

  // A *getter*, not the value. `run` re-reads it after the update has
  // committed, and a value captured at call time would describe the gate as it
  // was before the command — so a controller would read back the answer it had
  // just changed away from and send it again.
  const surface = useRef<AgentSurface>({
    view: () => buildSnapshot(latest.current).view,
    run: (raw) => run(() => latest.current, raw)
  })

  // Dev only, and the `import.meta.env.DEV` test compiles to a literal `false`
  // in a build — so the bundler drops this and a production page has no such
  // handle on `window`. The repository bridge does not use it; it holds the
  // surface directly.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__pdbfAgent = surface.current
    return () => {
      delete window.__pdbfAgent
    }
  }, [])

  return surface.current
}

function buildSnapshot(input: AgentSurfaceInput): ReturnType<typeof snapshot> {
  return snapshot({
    step: input.step,
    title: input.title,
    fileName: input.fileName,
    fileSize: input.fileSize ?? 0,
    pageCount: input.pageCount,
    progress: input.progress,
    questions: input.questions,
    answers: input.answers,
    missing: input.missing,
    ...(input.busy ? { busy: input.busy } : {}),
    ...(input.error ? { error: input.error } : {})
  })
}

async function run(current: () => AgentSurfaceInput, raw: unknown): Promise<CommandOutcome> {
  const input = current()
  const parsed = parseCommand(raw)
  if ('reason' in parsed) return { outcome: 'refused', reason: parsed.reason }
  const command = parsed.command

  if (command.op === 'state') {
    return { outcome: 'done', view: buildSnapshot(input).view }
  }

  if (command.op === 'answer') {
    // A question that is not on the gate is refused rather than stored. The
    // answer map is keyed by id and would accept anything; an answer written
    // against a question this step never asked sits there looking answered and
    // reaches whichever later gate happens to use that id.
    const asked = input.questions.some((q) => q.id === command.id)
    if (!asked) {
      return {
        outcome: 'refused',
        reason:
          `“${command.id}” is not being asked at “${input.title}”. ` +
          `This gate asks: ${input.questions.map((q) => q.id).join(', ') || '(nothing)'}.`
      }
    }
    input.setAnswer(command.id, command.value)
    const wanted = JSON.stringify(command.value)
    await settleUntil(() => {
      const now = current()
      // Or the question is gone: answering one can retire another, and waiting
      // for a value on a question that no longer exists would always time out.
      return (
        JSON.stringify(now.answers[command.id]) === wanted ||
        !now.questions.some((q) => q.id === command.id)
      )
    }, 500)
    return { outcome: 'done', view: buildSnapshot(current()).view }
  }

  if (command.op === 'advance') {
    const view = buildSnapshot(input).view
    if (!view.advance.unattended) {
      return { outcome: 'refused', reason: view.advance.refusal, view }
    }
    if (view.missing.length > 0) {
      // The button is disabled in this state, so pressing it would do nothing
      // and report success — the worst kind of reply to a controller that is
      // about to move on to the next command.
      return {
        outcome: 'refused',
        reason: `Still unanswered: ${view.missing.join(', ')}.`,
        view
      }
    }
    if (view.busy) {
      return { outcome: 'refused', reason: `“${view.busy}” is still running.`, view }
    }
    const leaving = view.step
    const asked = view.questions.map((q) => q.id).join(',')
    input.advance()
    // Any of the three is the gate having moved on: a new step, a stage
    // starting, or this step asking something different — which is what an
    // advance that puts up a cost estimate looks like.
    await settleUntil(() => {
      const now = current()
      return (
        now.step !== leaving ||
        Boolean(now.busy) ||
        now.questions.map((q) => q.id).join(',') !== asked
      )
    }, 3000)
    return { outcome: 'done', view: buildSnapshot(current()).view }
  }

  // evidence
  const { images } = buildSnapshot(input)
  const src = images.get(command.ref)
  if (src === undefined) {
    return {
      outcome: 'refused',
      reason: `No evidence called “${command.ref}” on this gate. Take a fresh state first.`
    }
  }
  try {
    const words = parseWordsRef(src)
    if (words) {
      // One page render, for the leaf actually being asked about. The URL is
      // minted here and nothing else will free it, so it is revoked as soon as
      // the bytes are read — a controller walking forty flagged leaves would
      // otherwise leak forty page-sized Blobs.
      const cut = await input.cropWords(words.pageIndex, [{ id: 'ref', tokenIds: words.tokenIds }])
      const url = cut.get('ref')
      if (!url) return { outcome: 'failed', reason: 'Those words could not be cut from the leaf.' }
      try {
        return { outcome: 'done', image: await imageAt(url) }
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    // A whole leaf: rendered at a size that can be read, not the thumbnail
    // blown up — the same distinction the lightbox makes on screen.
    const enlarged = await input.enlargeEvidence(src)
    if (enlarged) {
      try {
        return { outcome: 'done', image: await imageAt(enlarged) }
      } finally {
        URL.revokeObjectURL(enlarged)
      }
    }
    const resolved = input.resolveEvidence(src)
    if (!resolved) return { outcome: 'failed', reason: 'That evidence could not be resolved.' }
    return { outcome: 'done', image: await imageAt(resolved) }
  } catch (err) {
    return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}
