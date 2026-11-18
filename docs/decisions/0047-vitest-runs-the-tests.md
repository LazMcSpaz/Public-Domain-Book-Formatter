# 0047: Vitest runs the tests, in Node, with no browser

Status: inherited · Date: 2026-11-18

## Decision

Vitest 2 (`^2.1.8`) runs the unit tests (`npm test`). They live in `test/**/*.test.ts` and run in Node with no browser (`vitest.config.ts`). The tests are the gating check before committing, together with typecheck, format check and lint, and CI runs them on every push (`.github/workflows/ci.yml`). Several shelf scripts also run core modules through `vite-node` with the same configuration.

## Why (plain English)

Most of the logic is pure functions in `src/core` (0002), so it can be tested quickly and without a browser, using the same aliases as the app. A passing suite is what lets a change be trusted, which is exactly why each test must be shown to fail against the fault it guards.

## What we gave up

Browser-based unit tests. Anything that needs a real page is checked by the Playwright scripts instead (0048).

## Rule for agents

Run `npm test`, with typecheck, format:check and lint, before committing. A new test counts only once it has been seen to fail with the fault put back: a test that passes before and after the fix is not a test. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1326–1354, 1478–1486, 1800; vitest.config.ts; .github/workflows/ci.yml.
