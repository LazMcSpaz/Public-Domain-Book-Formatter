/**
 * The fact bank: what each book leaves behind after it is printed.
 *
 * Every book that goes through this app is read closely by something capable of
 * noticing what is in it, and then that reading is thrown away. This keeps it,
 * so a shelf of reprints becomes material to write *from* rather than forty
 * finished PDFs.
 *
 * Built around primary attestation, not summary — the value of an entry is that
 * a named work of a known year is on record saying it, with the words to prove
 * it. The app's job ends at writing a good file; consolidating a shelf of them
 * is a separate tool for when there is a shelf.
 */
export {
  FOOTINGS,
  FOOTING_LABEL,
  MAX_PROMPT_TAGS,
  canonicalTag,
  canonicalTags,
  emptyVocabulary,
  factId,
  growVocabulary,
  normalizeTag,
  normalizeVocabulary,
  topTags,
  type Fact,
  type FactSource,
  type Footing,
  type RawFact,
  type TagVocabulary
} from './fact'
export {
  CHUNK_WORDS,
  NOT_PROSE,
  OVERLAP_WORDS,
  chunkBlocks,
  contextFor,
  renderChunk,
  type BookChunk,
  type ChunkOptions
} from './chunk'
export { FACT_ITEM_SCHEMA, FACT_LIST_SCHEMA, checkFacts, dedupeFacts, parseFacts } from './schema'
export {
  FACTS_PER_THOUSAND_WORDS,
  buildHarvestBlock,
  buildHarvestSystemPrompt,
  type HarvestDepth,
  type HarvestPromptOptions
} from './prompt'
export {
  buildHarvestBody,
  runHarvest,
  type HarvestRunOptions,
  type HarvestRunResult
} from './runner'
export { estimateHarvestCost, type HarvestCost, type HarvestCostInputs } from './cost'
export { bankStem, renderBank, renderBankJsonl, renderBankMarkdown, type BankFile } from './export'
export { factsFromNotes, type ApprovedNote } from './from-notes'
export type { BookFacts } from './source'
