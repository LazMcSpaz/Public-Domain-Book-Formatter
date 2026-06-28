/**
 * ProjectFile construction & migration (SPEC §9).
 *
 * A project is a directory: a `project.json` manifest (the serialized
 * `ProjectFile`) plus an `assets/` dir for page images. `schemaVersion` drives
 * migration on load so older saves keep opening as the model evolves.
 */
import type {
  Flag,
  FrontMatterFields,
  ImageEditDescriptor,
  MappingEntry,
  PerBookConfig,
  ProjectFile,
  ReadingProgress,
  SourcePage,
  StructuralTag,
  FindReplaceRule
} from '@core/model'

/**
 * Current manifest schema version. Bump + extend `migrate` on shape changes.
 * v2 adds the `markdown` output field (SPEC §3/§4 review instrument).
 * v3 adds `styleProfileId` + `frontMatter` (SPEC §7 templates/style system).
 */
export const CURRENT_SCHEMA_VERSION = 3

/** Default per-book config (SPEC §7). Content is filled in by the user later. */
function defaultConfig(): PerBookConfig {
  return {
    title: '',
    author: '',
    isbn: null,
    editionDate: null,
    trimSize: '6x9'
  }
}

function defaultReadingProgress(): ReadingProgress {
  return { lastPageIndex: 0, approvedPages: [] }
}

function defaultFrontMatter(): FrontMatterFields {
  return {
    isbn: null,
    publicationDate: null,
    editionStatement: null,
    imprint: null,
    copyrightHolder: null,
    notices: []
  }
}

function normalizeFrontMatter(raw: unknown): FrontMatterFields {
  const base = defaultFrontMatter()
  if (!isObject(raw)) return base
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  return {
    isbn: str(raw.isbn),
    publicationDate: str(raw.publicationDate),
    editionStatement: str(raw.editionStatement),
    imprint: str(raw.imprint),
    copyrightHolder: str(raw.copyrightHolder),
    notices: Array.isArray(raw.notices)
      ? (raw.notices.filter((n) => typeof n === 'string') as string[])
      : base.notices
  }
}

/** Build a fresh, valid `ProjectFile` for a newly imported PDF. */
export function createEmptyProject(init: {
  pdfPath: string
  pageCount: number
  config?: Partial<PerBookConfig>
}): ProjectFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    source: {
      pdfPath: init.pdfPath,
      pageCount: init.pageCount
    },
    pages: [],
    markdown: '',
    coordinateMap: [],
    flags: [],
    tags: [],
    imageEdits: [],
    config: { ...defaultConfig(), ...init.config },
    findReplace: [],
    readingProgress: defaultReadingProgress(),
    styleProfileId: null,
    frontMatter: defaultFrontMatter()
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function normalizeConfig(raw: unknown): PerBookConfig {
  const base = defaultConfig()
  if (!isObject(raw)) return base
  return {
    title: typeof raw.title === 'string' ? raw.title : base.title,
    author: typeof raw.author === 'string' ? raw.author : base.author,
    isbn: typeof raw.isbn === 'string' ? raw.isbn : null,
    editionDate: typeof raw.editionDate === 'string' ? raw.editionDate : null,
    trimSize: typeof raw.trimSize === 'string' ? raw.trimSize : base.trimSize
  }
}

function normalizeReadingProgress(raw: unknown): ReadingProgress {
  const base = defaultReadingProgress()
  if (!isObject(raw)) return base
  const lastPageIndex =
    typeof raw.lastPageIndex === 'number' ? raw.lastPageIndex : base.lastPageIndex
  const approvedPages = Array.isArray(raw.approvedPages)
    ? (raw.approvedPages.filter((n) => typeof n === 'number') as number[])
    : base.approvedPages
  return { lastPageIndex, approvedPages }
}

/**
 * Validate & normalize an unknown parsed manifest, upgrading older
 * `schemaVersion`s to the current one. Missing fields are backfilled with
 * defaults. Throws a clear error if `raw` is not a plausible project object.
 */
export function migrate(raw: unknown): ProjectFile {
  if (!isObject(raw)) {
    throw new Error('Invalid project file: manifest is not an object.')
  }

  // A plausible project has a `source` with a pdfPath. This is the minimal
  // signal distinguishing a real (if old) manifest from arbitrary JSON.
  const source = raw.source
  if (!isObject(source) || typeof source.pdfPath !== 'string') {
    throw new Error('Invalid project file: missing or malformed `source.pdfPath`.')
  }

  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project schema version ${version} is newer than supported (${CURRENT_SCHEMA_VERSION}). ` +
        'Please update the application.'
    )
  }

  // For now there is a single forward path: anything at or below v1 normalizes
  // into the v1 shape by backfilling defaults. Future versions add steps here.
  const pageCount = typeof source.pageCount === 'number' ? source.pageCount : 0

  const project: ProjectFile = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    source: {
      pdfPath: source.pdfPath,
      pageCount
    },
    pages: asArray<SourcePage>(raw.pages),
    markdown: typeof raw.markdown === 'string' ? raw.markdown : '',
    coordinateMap: asArray<MappingEntry>(raw.coordinateMap),
    flags: asArray<Flag>(raw.flags),
    tags: asArray<StructuralTag>(raw.tags),
    imageEdits: asArray<ImageEditDescriptor>(raw.imageEdits),
    config: normalizeConfig(raw.config),
    findReplace: asArray<FindReplaceRule>(raw.findReplace),
    readingProgress: normalizeReadingProgress(raw.readingProgress),
    styleProfileId: typeof raw.styleProfileId === 'string' ? raw.styleProfileId : null,
    frontMatter: normalizeFrontMatter(raw.frontMatter)
  }

  return project
}
