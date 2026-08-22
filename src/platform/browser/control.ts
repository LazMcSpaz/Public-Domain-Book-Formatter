/**
 * The control channel, carried by a repository the user owns.
 *
 * There is no server here — that is the whole architecture — so a controller
 * outside the tab and the tab itself need somewhere they can both reach. The
 * app already has one: the shelf is a git repository written to directly from
 * the page with the user's own fine-grained token. This rides the same rail,
 * with the same plumbing (`putFile`, `getText`) and the same credential rules,
 * and adds no new way in.
 *
 * Two files per session. `inbox.json` is written by the controller and read
 * here; `outbox.json` is written here and read by the controller. Separate
 * files because each side then only ever writes its own, so the contents API's
 * sha dance can never turn into two writers colliding on one blob.
 *
 * ## What this is not
 *
 * It is not fast, and it should not pretend to be: the round trip is one poll
 * interval, so this is for a book being worked through by someone who is not
 * at the keyboard, not for a live cursor. And it is not a way to spend money —
 * see `@core/control`, where the refusals live and are tested.
 *
 * ## Where it must not be pointed
 *
 * At a public repository. Every command and every gate snapshot lands in a git
 * history, and a git history cannot be taken back. The Settings panel says so
 * out loud for the shelf and says it again here; a control session belongs in a
 * private repository, which may well be a different one from the shelf.
 *
 * Browser-only.
 */
import {
  CONTROL_VERSION,
  inboxPath,
  outboxPath,
  validSession,
  type Inbox,
  type Outbox,
  type Reply
} from '@core/control'
import type { ShelfConfig } from '@core/sync'
import { toBase64 } from '@core/project'
import { getText, putFile } from './shelf'
import type { AgentSurface } from '../../app/agent-surface'

/** A shelf's credentials plus the session name the files sit under. */
export interface ControlConfig extends ShelfConfig {
  session: string
}

/**
 * How often to look for a command.
 *
 * Ten seconds. A fine-grained token gets 5,000 requests an hour and a poll
 * costs one read plus, only when there is work, two writes — so this sits at
 * roughly a seventh of the budget and leaves room for the book saves that are
 * the repository's actual job.
 */
export const POLL_MS = 10_000

function encode(value: unknown): string {
  return toBase64(new TextEncoder().encode(JSON.stringify(value, null, 2)))
}

/** Read the commands waiting, or nothing when the file is not there yet. */
async function readInbox(config: ControlConfig): Promise<Inbox | null> {
  const raw = await getText(config, inboxPath(config.session))
  if (raw === null) return null
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) return null
  const commands = (parsed as { commands?: unknown }).commands
  if (!Array.isArray(commands)) return null
  // Shapes are checked one command at a time by `parseCommand`, not here: a
  // single malformed entry must refuse itself and leave the rest runnable.
  return { version: CONTROL_VERSION, commands: commands as Inbox['commands'] }
}

async function readOutbox(config: ControlConfig): Promise<Outbox> {
  const raw = await getText(config, outboxPath(config.session))
  if (raw === null) return { version: CONTROL_VERSION, replies: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    const replies = (parsed as { replies?: unknown }).replies
    return {
      version: CONTROL_VERSION,
      replies: Array.isArray(replies) ? (replies as Reply[]) : []
    }
  } catch {
    // A corrupt outbox would otherwise re-run every command in the inbox,
    // because nothing in it would look answered. Starting a fresh one loses
    // the log; re-running `advance` loses the user's place in the book.
    return { version: CONTROL_VERSION, replies: [] }
  }
}

async function writeOutbox(config: ControlConfig, outbox: Outbox): Promise<void> {
  await putFile(
    config,
    outboxPath(config.session),
    encode(outbox),
    `control: ${config.session} replies (${outbox.replies.length})`
  )
}

export interface PollResult {
  /** Commands executed this time round. */
  handled: number
  /** Waiting to be executed after this pass — always 0 unless something threw. */
  pending: number
  /** The last thing that happened, for the panel on screen. */
  note?: string
}

/**
 * One pass: run whatever is waiting, and record what happened.
 *
 * Commands already in the outbox are never run again, whatever they say —
 * including the `started` claims, which is the point of them.
 */
export async function pollOnce(
  config: ControlConfig,
  surface: AgentSurface,
  now: () => string = () => new Date().toISOString()
): Promise<PollResult> {
  if (!validSession(config.session)) {
    throw new Error(
      `“${config.session}” is not a usable session name: lower-case letters, digits and ` +
        'hyphens, starting with a letter or digit.'
    )
  }
  const inbox = await readInbox(config)
  if (!inbox || inbox.commands.length === 0) return { handled: 0, pending: 0 }

  const outbox = await readOutbox(config)
  const answered = new Set(outbox.replies.map((r) => r.id))
  const waiting = inbox.commands.filter((c) => typeof c?.id === 'string' && !answered.has(c.id))
  if (waiting.length === 0) return { handled: 0, pending: 0 }

  let handled = 0
  let note: string | undefined
  for (const envelope of waiting) {
    // The claim, written before the command runs. See `Reply.outcome`.
    outbox.replies.push({
      id: envelope.id,
      at: now(),
      outcome: 'started',
      reason:
        'This command was started. If it still says this, the tab stopped before its result ' +
        'was recorded and it is not known whether it took effect — it will not be run again.'
    })
    await writeOutbox(config, outbox)

    const result = await surface.run(envelope.command)
    outbox.replies = outbox.replies.filter((r) => r.id !== envelope.id)
    outbox.replies.push({ id: envelope.id, at: now(), ...result })
    await writeOutbox(config, outbox)
    handled += 1
    note = `${describe(envelope.command)} — ${result.outcome}${result.reason ? `: ${result.reason}` : ''}`
  }
  return { handled, pending: 0, ...(note ? { note } : {}) }
}

/** A command in a few words, for the panel the user watches. */
function describe(command: unknown): string {
  const op = (command as { op?: unknown })?.op
  if (op === 'answer') return `answer ${String((command as { id?: unknown }).id)}`
  if (op === 'evidence') return `evidence ${String((command as { ref?: unknown }).ref)}`
  return typeof op === 'string' ? op : 'unknown command'
}
