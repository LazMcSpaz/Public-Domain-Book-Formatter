/**
 * The plain-English text `work.mjs` prints: the Workroom's three lists, and
 * one run with its timeline. Wording only; every judgement (stale, picked
 * up, a book's stage) is made by core's `workroom` and only shown here.
 */

/** "2026-11-19 14:05 UTC". */
export function when(at) {
  return `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`
}

/** "5 minutes ago", "3 hours ago", "2 days ago". */
export function ago(at, now) {
  const minutes = Math.round((Date.parse(now) - Date.parse(at)) / 60000)
  const n = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'} ago`
  if (minutes < 1) return 'just now'
  if (minutes < 60) return n(minutes, 'minute')
  if (minutes < 48 * 60) return n(Math.round(minutes / 60), 'hour')
  return n(Math.round(minutes / 1440), 'day')
}

export function progressText(p) {
  return p ? `${p.done} of ${p.total} ${p.unit}` : ''
}

/** How a run stands, in words: "waiting on you", "handed off to Checker (picked up by x)". */
function standing(run, w, now) {
  const { SHOWN_LABELS, ROLE_LABELS } = w
  if (run.shown === 'stale')
    return `stale: no word for ${ago(run.updatedAt, now).replace(' ago', '')}`
  if (run.shown === 'handed-off' && run.handoff) {
    const to = ROLE_LABELS[run.handoff.role]
    const taken = run.handoff.pickedUpBy
      ? `picked up by ${run.handoff.pickedUpBy}`
      : 'not picked up yet'
    return `handed off to ${to} (${taken})`
  }
  return SHOWN_LABELS[run.shown]
}

/** One run on one line: id, who, where, the job, how it stands, how far. */
function runLine(run, w, now, { role = true, book = true } = {}) {
  const who = [
    role ? w.ROLE_LABELS[run.role] : '',
    book && run.book ? run.book : '',
    run.stage ? w.STAGE_LABELS[run.stage].toLowerCase() : ''
  ].filter(Boolean)
  const far = progressText(run.progress)
  const said = run.result ? `: "${run.result}"` : ''
  return (
    `${run.id} ${who.length ? `${who.join(', ')}: ` : ''}${run.job} [${standing(run, w, now)}` +
    `${far ? `, ${far}` : ''}, ${ago(run.updatedAt, now)}]${said}`
  )
}

/** A stage of a book: how it stands, how many runs, and the latest. */
function stageLine(s, w, now) {
  const r = s.latest
  const how = s.shown === r.shown ? standing(r, w, now) : w.SHOWN_LABELS[s.shown]
  const runs = `${s.runs} run${s.runs === 1 ? '' : 's'}${s.live && s.runs > 1 ? `, ${s.live} live` : ''}`
  const far = progressText(r.progress)
  const said = r.result ? `: "${r.result}"` : ''
  return (
    `${w.STAGE_LABELS[s.stage]}: ${how}. ${runs}; latest ${r.id} by ${w.ROLE_LABELS[r.role]}, ` +
    `${ago(r.updatedAt, now)}${far ? `, ${far}` : ''}${said}`
  )
}

const EVENT_WORDS = {
  working: 'working',
  waiting: 'waiting on the owner',
  done: 'done',
  failed: 'failed',
  'handed-off': 'handed off'
}

function links(owner) {
  return owner.links.map((l) => `${l.label}, ${l.path}`).join('; ')
}

/** The three lists, filtered to one book or role when asked. */
export function printWorkroom(room, w, { shelf, count, book, role }) {
  const out = []
  const now = room.now
  const keep = (r) => (!book || r.book === book) && (!role || r.role === role)
  out.push(`Status notes on ${shelf}: ${count} run${count === 1 ? '' : 's'}, read ${when(now)}.`)

  const waiting = room.waiting.filter(keep)
  out.push('', `WAITING ON YOU (${waiting.length})`)
  if (!waiting.length) out.push('  Nothing is waiting on you.')
  waiting.forEach((r, i) => {
    out.push(`  ${i + 1}. ${r.owner.what}`)
    const where = [w.ROLE_LABELS[r.role], r.book, r.stage && w.STAGE_LABELS[r.stage].toLowerCase()]
    out.push(
      `     ${where.filter(Boolean).join(', ')}; asked ${ago(r.updatedAt, now)} (run ${r.id})`
    )
    out.push(`     Open: ${links(r.owner)}`)
  })

  const books = room.books.filter(
    (b) => (!book || b.book === book) && (!role || b.latest.some(keep))
  )
  out.push('', `BOOKS (${books.length})`)
  if (!books.length) out.push('  No book has a status note yet.')
  for (const b of books) {
    const asks = b.waiting && b.shown !== 'waiting' ? `; ${b.waiting} waiting on you` : ''
    out.push(
      `  ${b.book}: at ${w.STAGE_LABELS[b.stage].toLowerCase()}, ${w.SHOWN_LABELS[b.shown]}${asks}`
    )
    for (const s of b.stages) out.push(`     ${stageLine(s, w, now)}`)
  }

  out.push('', 'ROLES')
  const idle = []
  for (const r of room.roles) {
    if (role && r.role !== role) continue
    const going = r.inProgress.filter(keep)
    const done = r.recent.filter(keep)
    const handed = r.awaiting.filter((x) => !book || x.book === book)
    if (!going.length && !done.length && !handed.length) {
      idle.push(r.label)
      continue
    }
    out.push(`  ${r.label}`)
    for (const x of going) out.push(`     in progress: ${runLine(x, w, now, { role: false })}`)
    for (const x of handed) {
      out.push(
        `     handed to this role by ${w.ROLE_LABELS[x.role]}, not picked up: ${runLine(x, w, now)}`
      )
    }
    for (const x of done) out.push(`     finished: ${runLine(x, w, now, { role: false })}`)
  }
  if (idle.length) out.push(`  Nothing in progress or finished lately: ${idle.join(', ')}.`)
  return out.join('\n')
}

/** One run: what it is, how it stands, and its whole timeline. */
export function printRun(run, note, w, now) {
  const out = []
  const where = [
    w.ROLE_LABELS[run.role],
    run.book ?? 'no book',
    run.stage && w.STAGE_LABELS[run.stage]
  ]
  out.push(`Run ${run.id}: ${where.filter(Boolean).join(', ')}`)
  out.push(`Job: ${run.job}`)
  out.push(`Now: ${standing(run, w, now)}${run.progress ? `, ${progressText(run.progress)}` : ''}`)
  if (run.owner) out.push(`Waiting on you for: ${run.owner.what}`, `Open: ${links(run.owner)}`)
  if (run.result) out.push(`Result: ${run.result}`)
  if (run.from) out.push(`Took over from: ${run.from}`)
  const handed = run.pickedUp.filter((id) => id !== run.from)
  if (handed.length) out.push(`Picked up the hand-off of: ${handed.join(', ')}`)
  if (run.followedBy.length) out.push(`Taken over by: ${run.followedBy.join(', ')}`)
  if (run.files.length) out.push(`Files left: ${run.files.join(', ')}`)
  out.push(
    `Started ${when(run.startedAt)}; last word ${when(run.updatedAt)} (${ago(run.updatedAt, now)})`
  )
  out.push(`Note: ${run.path}`, '', 'Timeline:')
  note.history.forEach((e, i) => {
    const to =
      e.state === 'handed-off' && note.handoff ? ` to ${w.ROLE_LABELS[note.handoff.role]}` : ''
    const word = i === 0 ? 'started' : `${EVENT_WORDS[e.state]}${to}`
    const bits = [e.note, progressText(e.progress), e.owner ? `asks: ${e.owner.what}` : '']
    const more = bits.filter(Boolean).join('; ')
    out.push(`  ${when(e.at)}  ${word}${more ? `: ${more}` : ''}`)
  })
  return out.join('\n')
}
