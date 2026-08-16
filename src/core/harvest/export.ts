/**
 * Writing the bank out.
 *
 * Two files from one structure, for two different readers:
 *
 * - **Markdown**, for a person. Grouped by category, quotations set as
 *   quotations, provenance on every entry. This is the file that gets skimmed
 *   two years from now while looking for something half-remembered.
 * - **JSONL**, one entry per line, for whatever consolidates a shelf of these
 *   later. This is what turns "merge forty files" from a weekend into a short
 *   script — it can be sorted, filtered by footing, grouped by tag and deduped
 *   without parsing prose.
 *
 * The same discipline as the tables: one structure, two renderings, and the
 * derived one never edited by hand.
 *
 * A deliberate non-feature: nothing here merges across books. Two books
 * attesting the same thing is *corroboration*, and the moment this collapsed
 * that into one entry it would destroy the most valuable signal the bank can
 * carry. Merging belongs to whatever consolidates the files, where the decision
 * can be made with all of them in view.
 *
 * Pure: facts in, strings out.
 */
import { FOOTING_LABEL, type Fact, type FactSource } from './fact'

/** A file to write, named and ready. */
export interface BankFile {
  fileName: string
  contents: string
  mimeType: string
}

/** A filename stem that will not fight with a filesystem or a later sort. */
export function bankStem(source: FactSource): string {
  const slug = (text: string): string =>
    text
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 48)

  const parts = [slug(source.author), slug(source.title)].filter(Boolean)
  const year = source.originalYear.replace(/[^0-9]/gu, '').slice(0, 4)
  if (year) parts.push(year)
  return parts.join('--') || 'fact-bank'
}

function groupByCategory(facts: readonly Fact[]): Map<string, Fact[]> {
  const groups = new Map<string, Fact[]>()
  for (const fact of facts) {
    const list = groups.get(fact.category) ?? []
    list.push(fact)
    groups.set(fact.category, list)
  }
  // Biggest first: the categories a book is actually about should be at the
  // top of the file, not wherever the alphabet puts them.
  return new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length))
}

/** Every tag in the file, with how many entries carry it. */
function tagIndex(facts: readonly Fact[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const fact of facts) {
    for (const tag of fact.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/**
 * The readable file.
 *
 * Every entry carries its footing and its page whether or not that reads
 * prettily, because an entry whose standing is not on the page is an entry that
 * will be trusted for the wrong reasons later.
 */
export function renderBankMarkdown(source: FactSource, facts: readonly Fact[]): string {
  const lines: string[] = []
  const cite = [source.author, source.originalYear].filter(Boolean).join(', ')

  lines.push(`# ${source.title || 'Untitled'}${cite ? ` — ${cite}` : ''}`, ``)
  lines.push(
    `Harvested ${source.harvestedAt.slice(0, 10)} from \`${source.fileName}\`. ` +
      `${facts.length} entr${facts.length === 1 ? 'y' : 'ies'}.`,
    ``
  )
  lines.push(
    `Page numbers are leaves of the **scan**, not of the printed reprint.`,
    `Every entry is marked with its footing: what the book states, what it`,
    `implies, and what was supplied from outside it. Only \`stated\` entries`,
    `carry a quotation, and every quotation here was checked against the book's`,
    `own text.`,
    ``
  )

  const index = tagIndex(facts)
  if (index.length > 0) {
    lines.push(`**Tags in this book:** ${index.map(([t, n]) => `${t} (${n})`).join(' · ')}`, ``)
  }

  for (const [category, group] of groupByCategory(facts)) {
    lines.push(`## ${category}`, ``)
    for (const fact of group) {
      lines.push(`### ${fact.title}`, ``)

      const meta: string[] = [FOOTING_LABEL[fact.footing]]
      if (fact.sourcePage !== null) meta.push(`scan p. ${fact.sourcePage + 1}`)
      if (fact.demotedFrom) {
        meta.push(`marked "${fact.demotedFrom}" but its quotation was not in the book`)
      }
      lines.push(`*${meta.join(' · ')}*`, ``)

      if (fact.tags.length > 0) lines.push(`**Tags:** ${fact.tags.join(', ')}`, ``)
      if (fact.quote) {
        lines.push(...fact.quote.split(/\n+/u).map((line) => `> ${line.trim()}`), ``)
      }
      lines.push(fact.body, ``)
      lines.push(`\`${fact.id}\``, ``)
    }
  }

  return lines.join('\n')
}

/** One entry per line, each carrying its book so files can be concatenated. */
export function renderBankJsonl(source: FactSource, facts: readonly Fact[]): string {
  return facts
    .map((fact) =>
      JSON.stringify({
        id: fact.id,
        title: fact.title,
        body: fact.body,
        footing: fact.footing,
        ...(fact.demotedFrom ? { demotedFrom: fact.demotedFrom } : {}),
        category: fact.category,
        tags: fact.tags,
        quote: fact.quote,
        quoteVerified: fact.quoteVerified,
        sourcePage: fact.sourcePage,
        blockId: fact.blockId,
        // Repeated on every line on purpose: `cat *.jsonl` has to be a valid
        // way to combine banks, and a header line would not survive that.
        source: {
          title: source.title,
          author: source.author,
          originalYear: source.originalYear,
          fileName: source.fileName,
          harvestedAt: source.harvestedAt
        }
      })
    )
    .join('\n')
}

/** Both files, ready to be written. */
export function renderBank(source: FactSource, facts: readonly Fact[]): BankFile[] {
  const stem = bankStem(source)
  return [
    {
      fileName: `${stem}.facts.md`,
      contents: renderBankMarkdown(source, facts),
      mimeType: 'text/markdown'
    },
    {
      fileName: `${stem}.facts.jsonl`,
      contents: renderBankJsonl(source, facts),
      mimeType: 'application/x-ndjson'
    }
  ]
}
