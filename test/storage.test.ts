import { describe, expect, it } from 'vitest'
import {
  addStorageRow,
  extensionOf,
  fingerprintOf,
  isTestKey,
  parseStorageList,
  serializeStorageList,
  storageKey,
  stripBom,
  type StorageRow
} from '@core/sync'

// Synthetic fingerprints: no real file is named here.
const A = 'a'.repeat(64)
const B = '0123456789abcdef'.repeat(4)
const HEADER = 'key\tsha256\tbytes\tfrom\tadded'

const row = (over: Partial<StorageRow> = {}): StorageRow => ({
  key: `sources/${A}.pdf`,
  sha256: A,
  bytes: 1234,
  from: 'sources/Some-Book.pdf',
  added: '2026-11-18',
  ...over
})

describe('storage keys', () => {
  it('names a file by kind, fingerprint and lower-case extension', () => {
    expect(storageKey('sources', A, 'pdf')).toBe(`sources/${A}.pdf`)
    expect(storageKey('exports', B.toUpperCase(), '.EPUB')).toBe(`exports/${B}.epub`)
    expect(storageKey('_test', A, '')).toBe(`_test/${A}`)
  })

  it('keeps the capitals of a book folder or edition after the kind', () => {
    expect(storageKey('editions/Crowley-TheBookOfTheGoetia-1rjx53s/1.0', A, 'pdf')).toBe(
      `editions/Crowley-TheBookOfTheGoetia-1rjx53s/1.0/${A}.pdf`
    )
  })

  it('refuses a bad kind, fingerprint or extension rather than guessing', () => {
    expect(() => storageKey('Sources', A, 'pdf')).toThrow(/storage kind/)
    expect(() => storageKey('../scans', A, 'pdf')).toThrow(/storage kind/)
    expect(() => storageKey('sources', A.slice(1), 'pdf')).toThrow(/fingerprint/)
    expect(() => storageKey('sources', A, 'p d f')).toThrow(/extension/)
  })

  it('takes the last extension of a name, lower case, and none when odd', () => {
    expect(extensionOf('C:\\shelf\\sources\\Book.PDF')).toBe('pdf')
    expect(extensionOf('books/x/recon.json.gz')).toBe('gz')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('file.tar~')).toBe('')
  })

  it('reads the fingerprint back out of a key', () => {
    expect(fingerprintOf(`sources/${A}.pdf`)).toBe(A)
    expect(fingerprintOf(`scans/${B.toUpperCase()}`)).toBe(B)
    expect(fingerprintOf('sources/plain-name.pdf')).toBeNull()
    // 65 hex digits is not a fingerprint standing alone.
    expect(fingerprintOf(`sources/${A}b.pdf`)).toBeNull()
    // Every key the namer makes gives its fingerprint back.
    expect(fingerprintOf(storageKey('figures', B, 'tif'))).toBe(B)
  })

  it('lets only self-test objects be deleted', () => {
    expect(isTestKey(`_test/${A}.bin`)).toBe(true)
    expect(isTestKey(`sources/${A}.pdf`)).toBe(false)
    expect(isTestKey(`_test/../sources/${A}.pdf`)).toBe(false)
    expect(isTestKey(`x_test/${A}.pdf`)).toBe(false)
  })
})

describe('STORAGE.tsv', () => {
  it('round-trips rows through the text', () => {
    const rows = [row(), row({ key: `exports/${B}.epub`, sha256: B, bytes: 0, from: 'b.epub' })]
    const text = serializeStorageList(rows)
    expect(text.split('\n')[0]).toBe(HEADER)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseStorageList(text)).toEqual(rows)
  })

  it('reads a list saved on Windows: byte-order mark and CRLF', () => {
    const text = `\uFEFF${HEADER}\r\n${serializeStorageList([row()]).split('\n')[1]}\r\n`
    expect(parseStorageList(text)).toEqual([row()])
    expect(stripBom('\uFEFF{"a":1}')).toBe('{"a":1}')
    expect(stripBom('{"a":1}')).toBe('{"a":1}')
  })

  it('treats an empty file as an empty list', () => {
    expect(parseStorageList('')).toEqual([])
    expect(parseStorageList(`${HEADER}\n`)).toEqual([])
  })

  it('refuses a list it cannot read, naming the line', () => {
    const good = serializeStorageList([row()])
    expect(() => parseStorageList(good.replace('key\t', 'name\t'))).toThrow(/line 1: expected/)
    expect(() => parseStorageList(`${good}just one column\n`)).toThrow(/line 3: 1 columns/)
    expect(() => parseStorageList(good.replace('\t1234\t', '\tlots\t'))).toThrow(/line 2:.*size/)
    expect(() => parseStorageList(good + good.split('\n')[1] + '\n')).toThrow(/listed twice/)
    const swapped = good.replace(`\t${A}\t`, `\t${B}\t`)
    expect(() => parseStorageList(swapped)).toThrow(/key names/)
  })

  it('adds a row once: the same key again is not a second row', () => {
    const first = addStorageRow([], row())
    expect(first.added).toBe(true)
    expect(first.rows).toHaveLength(1)
    const again = addStorageRow(
      first.rows,
      row({ from: 'elsewhere/copy.pdf', added: '2026-12-01' })
    )
    expect(again.added).toBe(false)
    expect(again.rows).toEqual(first.rows)
    expect(again.existing?.from).toBe('sources/Some-Book.pdf')
    const other = addStorageRow(again.rows, row({ key: `sources/${B}.pdf`, sha256: B }))
    expect(other.added).toBe(true)
    expect(other.rows.map((r) => r.sha256)).toEqual([A, B])
  })

  it('refuses a row that would break the list', () => {
    expect(() => addStorageRow([], row({ from: 'a\tb' }))).toThrow(/tab or a line break/)
    expect(() => addStorageRow([], row({ sha256: B }))).toThrow(/key names/)
    expect(() => addStorageRow([], row({ added: '18 Nov' }))).toThrow(/date/)
    expect(() => serializeStorageList([row({ bytes: -1 })])).toThrow(/size/)
  })
})
