/**
 * Public surface of the core engine: domain model, hOCR parsing, and project
 * persistence. Consumers can import submodules directly (`@core/model`,
 * `@core/hocr`, `@core/project`) or the aggregate from `@core`.
 */
export * from './model'
export * from './hocr'
export * from './project'
