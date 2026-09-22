/**
 * What a book is made of, and which stages of the reading that decides.
 *
 * `shape.ts` turns measurements of a file into a `BookShape` — pixels or not,
 * where the text came from, whether a second digitisation exists — and
 * `route.ts` turns a shape into the stages that apply. `coverage.ts` is the
 * one measurement that needs explaining: whether a page is a photograph, read
 * off its drawing instructions.
 */
export {
  largestImageCoverage,
  SCANNED_COVERAGE,
  type CoverageOps,
  type MatrixMultiply
} from './coverage'
export {
  shapeOfPdf,
  shapeOfEpub,
  declaredShape,
  parseShape,
  describeShape,
  TEXT_LAYER_FLOOR,
  type BookShape,
  type TextLayer,
  type Container,
  type PageSample,
  type PdfMeasurement,
  type EpubOrigin
} from './shape'
export {
  routeFor,
  routeKey,
  routeByKey,
  allRoutes,
  routeTable,
  withRouteTable,
  FLOW_BEGIN,
  FLOW_END,
  STAGE_IDS,
  ROUTE_KEYS,
  type Route,
  type RouteKey,
  type Stage,
  type StageId,
  type Reading,
  type Accepter
} from './route'
