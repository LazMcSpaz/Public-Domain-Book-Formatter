/**
 * The tags an exported chapter carries, worked out from the record
 * `read-book.mjs` writes beside each rendering.
 *
 * Pure, and kept apart from `master-audio.mjs` so it can be tested without
 * ffmpeg: what ffmpeg is *asked* for is the part that can be wrong quietly —
 * a chapter called "chapter-03" in a player, or every file of a book filed
 * under a different album — and the part that runs `ffmpeg` is checked on the
 * runner with `ffprobe` instead.
 *
 * ID3 v2.3, because that is the version every player reads; v2.4 is what
 * ffmpeg writes by default and is the one some car stereos and older
 * players show as blank.
 */

/** Words left in lower case inside a title, unless they open it. */
const SMALL = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to'
])

/**
 * A chapter title as a player should show it. The book prints its titles in
 * capitals — "STRATEGIC THERAPY" — which a screen reads as shouting; a title
 * set in any other case is left exactly as the book set it, initials and all.
 */
export function displayTitle(title) {
  const trimmed = title.trim()
  if (trimmed === '' || trimmed !== trimmed.toUpperCase() || trimmed === trimmed.toLowerCase()) {
    return trimmed
  }
  return trimmed
    .toLowerCase()
    .split(/(\s+|-)/u)
    .map((part, i) =>
      /^\s+$|^-$/u.test(part) || part === ''
        ? part
        : i !== 0 && SMALL.has(part)
          ? part
          : part[0].toUpperCase() + part.slice(1)
    )
    .join('')
}

/** "I. Strategic Therapy" — the number line over the title, where there is one. */
export function chapterName(record) {
  const title = displayTitle(record.title ?? '')
  const label = (record.label ?? '').trim().replace(/\.$/u, '')
  return label ? `${label}. ${title}` : title
}

/**
 * The `-metadata` arguments for one chapter. Every value comes from the
 * record; nothing is invented, and a book whose file names no author gets no
 * artist tag rather than a made-up one.
 */
export function tagsFor(record) {
  const pairs = [['title', chapterName(record)]]
  if (record.author) pairs.push(['artist', record.author], ['album_artist', record.author])
  if (record.bookTitle) pairs.push(['album', record.bookTitle])
  if (record.subtitle) pairs.push(['comment', record.subtitle])
  if (record.year) pairs.push(['date', String(record.year)])
  if (record.chapter) {
    pairs.push([
      'track',
      record.chapterCount ? `${record.chapter}/${record.chapterCount}` : String(record.chapter)
    ])
  }
  pairs.push(['genre', 'Audiobook'])
  const args = ['-id3v2_version', '3']
  for (const [key, value] of pairs) args.push('-metadata', `${key}=${value}`)
  return args
}

/** What `ffprobe -show_format` must show for the tags to count as written. */
export function expectedTags(record) {
  const out = {}
  for (const [key, value] of tagsFor(record)
    .filter((a) => a.includes('='))
    .map((a) => a.split(/=(.*)/su))) {
    out[key] = value
  }
  return out
}
