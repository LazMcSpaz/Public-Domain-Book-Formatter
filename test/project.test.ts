import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  createEmptyProject,
  migrate,
  saveProject,
  loadProject,
  manifestPath
} from '@core/project'

const tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pdbf-proj-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('createEmptyProject', () => {
  it('produces a valid ProjectFile with sensible defaults', () => {
    const p = createEmptyProject({ pdfPath: '/books/x.pdf', pageCount: 42 })
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(p.source).toEqual({ pdfPath: '/books/x.pdf', pageCount: 42 })
    expect(p.pages).toEqual([])
    expect(p.coordinateMap).toEqual([])
    expect(p.flags).toEqual([])
    expect(p.tags).toEqual([])
    expect(p.imageEdits).toEqual([])
    expect(p.findReplace).toEqual([])
    expect(p.config.trimSize).toBe('6x9')
    expect(p.config.isbn).toBeNull()
    expect(p.readingProgress).toEqual({ lastPageIndex: 0, approvedPages: [] })
  })

  it('merges a partial config override', () => {
    const p = createEmptyProject({
      pdfPath: '/x.pdf',
      pageCount: 1,
      config: { title: 'Moby-Dick', trimSize: '5x8' }
    })
    expect(p.config.title).toBe('Moby-Dick')
    expect(p.config.trimSize).toBe('5x8')
    expect(p.config.author).toBe('')
  })
})

describe('saveProject / loadProject round-trip', () => {
  it('persists and reloads an equivalent project', async () => {
    const dir = await makeTmpDir()
    const projDir = join(dir, 'mybook')
    const project = createEmptyProject({ pdfPath: '/books/y.pdf', pageCount: 3 })
    project.config.title = 'Test Title'
    project.readingProgress = { lastPageIndex: 2, approvedPages: [0, 1] }

    await saveProject(projDir, project)
    const loaded = await loadProject(projDir)
    expect(loaded).toEqual(project)
  })

  it('creates the project dir and assets/ dir', async () => {
    const dir = await makeTmpDir()
    const projDir = join(dir, 'fresh')
    await saveProject(projDir, createEmptyProject({ pdfPath: '/a.pdf', pageCount: 1 }))

    const assets = await stat(join(projDir, 'assets'))
    expect(assets.isDirectory()).toBe(true)
    const manifest = await stat(manifestPath(projDir))
    expect(manifest.isFile()).toBe(true)
  })

  it('leaves a valid JSON manifest and no temp files', async () => {
    const dir = await makeTmpDir()
    const projDir = join(dir, 'atomic')
    await saveProject(projDir, createEmptyProject({ pdfPath: '/b.pdf', pageCount: 1 }))

    const raw = await readFile(manifestPath(projDir), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()

    const { readdir } = await import('node:fs/promises')
    const files = await readdir(projDir)
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
    expect(files).toContain('project.json')
  })

  it('overwrites an existing manifest atomically on re-save', async () => {
    const dir = await makeTmpDir()
    const projDir = join(dir, 'resave')
    const p1 = createEmptyProject({ pdfPath: '/c.pdf', pageCount: 1 })
    await saveProject(projDir, p1)
    const p2 = createEmptyProject({ pdfPath: '/c.pdf', pageCount: 9 })
    await saveProject(projDir, p2)
    const loaded = await loadProject(projDir)
    expect(loaded.source.pageCount).toBe(9)
  })
})

describe('migrate', () => {
  it('fills missing fields with defaults', () => {
    const result = migrate({
      schemaVersion: 1,
      source: { pdfPath: '/m.pdf', pageCount: 5 }
    })
    expect(result.pages).toEqual([])
    expect(result.coordinateMap).toEqual([])
    expect(result.flags).toEqual([])
    expect(result.config.trimSize).toBe('6x9')
    expect(result.readingProgress).toEqual({ lastPageIndex: 0, approvedPages: [] })
  })

  it('upgrades a manifest with an absent schemaVersion to current', () => {
    const result = migrate({
      source: { pdfPath: '/old.pdf', pageCount: 2 },
      config: { title: 'Old Book' }
    })
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.config.title).toBe('Old Book')
    expect(result.config.trimSize).toBe('6x9')
  })

  it('upgrades a manifest with an older numeric schemaVersion', () => {
    const result = migrate({
      schemaVersion: 0,
      source: { pdfPath: '/v0.pdf', pageCount: 1 }
    })
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('normalizes partial config and readingProgress', () => {
    const result = migrate({
      source: { pdfPath: '/p.pdf' },
      readingProgress: { lastPageIndex: 7, approvedPages: [1, 'bad', 3] }
    })
    expect(result.source.pageCount).toBe(0)
    expect(result.readingProgress.lastPageIndex).toBe(7)
    expect(result.readingProgress.approvedPages).toEqual([1, 3])
  })

  it('throws on garbage input', () => {
    expect(() => migrate(null)).toThrow()
    expect(() => migrate(42)).toThrow()
    expect(() => migrate('not a project')).toThrow()
    expect(() => migrate([])).toThrow()
    expect(() => migrate({})).toThrow()
    expect(() => migrate({ source: {} })).toThrow()
    expect(() => migrate({ source: { pdfPath: 123 } })).toThrow()
  })

  it('throws when schema version is newer than supported', () => {
    expect(() =>
      migrate({
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        source: { pdfPath: '/future.pdf', pageCount: 1 }
      })
    ).toThrow()
  })
})

describe('loadProject error handling', () => {
  it('throws a clear error on invalid JSON', async () => {
    const dir = await makeTmpDir()
    const projDir = join(dir, 'bad')
    await mkdir(projDir, { recursive: true })
    await writeFile(manifestPath(projDir), '{ not json', 'utf8')
    await expect(loadProject(projDir)).rejects.toThrow(/not valid JSON/)
  })
})
