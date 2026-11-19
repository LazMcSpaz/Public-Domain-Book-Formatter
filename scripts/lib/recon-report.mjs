/**
 * What `drive.mjs recon` prints, built from what the page reports
 * (`reconBook` and `reconUnderWay` in `src/platform/browser/recon-run.ts`).
 * Plain Node, so the wording is tested without a browser.
 */

/** Milliseconds as a person reads them: `42s`, `3m 12s`, `1h 4m`. */
export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const WORDS = {
  cached: 'already cached',
  import: 'loaded from the shelf',
  read: 'read'
}

/** How far a reading under way has got, or that none is. */
export function statusReport(underWay, now, note) {
  if (!underWay) return { reading: 'none under way' }
  return {
    reading: 'under way',
    leaf: underWay.leaf,
    of: underWay.of,
    phase: underWay.phase,
    ...(underWay.resumedFrom > 0 ? { resumedFrom: underWay.resumedFrom } : {}),
    elapsed: duration(now - underWay.startedAt),
    ...(note ? { note } : {})
  }
}

/**
 * The report for one `recon`. `beside` is where the book's `recon.json.gz`
 * sits (or would), named in the closing hint so the session can keep a
 * reading taken here on the shelf.
 */
export function reconReport(outcome, { beside, now = Date.now() }) {
  if (outcome.action === 'under-way') return statusReport(outcome.underWay, now, outcome.why)
  if (outcome.action === 'not-applicable') return { reading: 'does not apply', why: outcome.why }
  const report = {
    reading: WORDS[outcome.action] ?? outcome.action,
    did: outcome.why,
    leaves: outcome.leaves,
    words: outcome.words,
    textFrom: outcome.textFrom,
    ...(outcome.resumedFrom > 0 ? { resumedFrom: outcome.resumedFrom } : {}),
    ...(outcome.action === 'import' ? { from: beside, readOn: outcome.readOn } : {}),
    took: duration(outcome.ms),
    ...(outcome.notes?.length > 0 ? { notes: outcome.notes } : {})
  }
  if (outcome.action === 'import') return report
  const target = beside ?? '<shelf>/books/<dir>/recon.json.gz'
  return {
    ...report,
    keep: `node scripts/drive.mjs reconexport ${target} keeps this reading on the shelf.`
  }
}
