/**
 * Pipeline stage contract (SPEC §3 processing pipeline).
 *
 * The pipeline is an ordered list of `Stage`s sharing one mutable
 * `PipelineContext`. Convention: a stage MUTATES the context in place (it reads
 * the accumulating state it needs and writes the fields it produces) and
 * resolves with `void`. This keeps the runner simple and the data flow explicit
 * — each stage's outputs are the next stage's inputs on the same object.
 */
import type {
  Flag,
  MappingEntry,
  SourceDocument,
  SourcePage,
  StructuralTag,
} from '@core/model'
import type { CommandRunner } from '@tooling/process'

/**
 * Shared, accumulating state threaded through every stage. Early stages fill in
 * `document`/`pages`/`coordinateMap`; later stages produce `markdown`/`flags`.
 */
export interface PipelineContext {
  /** Source PDF being processed. */
  readonly pdfPath: string
  /** Project directory results are persisted into. */
  readonly projectPath: string
  /** Scratch directory for page images, hOCR, intermediates. */
  readonly workDir: string
  /** Injectable command runner (real binaries in prod, mock in tests). */
  readonly run: CommandRunner
  /** Cancellation signal, honored between stages by the runner. */
  readonly signal?: AbortSignal

  // --- accumulating state (populated by stages) ---
  document?: SourceDocument
  pages?: SourcePage[]
  coordinateMap?: MappingEntry[]
  markdown?: string
  flags?: Flag[]
  /** Structural tags produced by the structure stage (persisted by the integrator). */
  tags?: StructuralTag[]
}

/** One step of the pipeline. Mutates `ctx`; resolves when done. */
export interface Stage {
  readonly name: string
  run(ctx: PipelineContext): Promise<void>
}
