# 0050: Small development tools

Status: inherited · Date: 2026-11-18

## Decision

TypeScript (`^5.6.3`) checks the code (`npm run typecheck`, also part of `npm run build`), with type definitions from `@types/node`, `@types/react` and `@types/react-dom`. ESLint 9 (`npm run lint`) uses `@eslint/js`, `typescript-eslint` and `globals`, configured in `eslint.config.mjs`. Prettier 3 (`npm run format`, `npm run format:check`) formats everything, configured in `.prettierrc.json` (no semicolons, single quotes, lines up to 100 characters). `word-list` is the English dictionary the spelling sheet reads (`scripts/spelling-of.ts`). All are development dependencies, and CI runs format check, lint, typecheck, tests and build on every push.

## Why (plain English)

These catch mistakes and keep formatting uniform without anyone having to think about it. They are the ordinary tools for a TypeScript project, and the dictionary lets the spelling sheet find the faults Amazon's own spelling check would find.

## What we gave up

Nothing significant was weighed; these are the usual choices.

## Rule for agents

Run typecheck, test, format:check and lint before committing. On a Windows checkout taken before `.gitattributes` arrived, line endings can make `format:check` fail on files nobody changed; check the files you changed and say so. Cleanup candidates, not decisions: `eslint-config-prettier` and `eslint-plugin-react-hooks` are declared in `package.json` but used by nothing (`eslint.config.mjs` imports neither); wire them in or remove them. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1195–1206, 1274–1295, 1478–1490, 1800; harness/sorting/part-4.md ("Packages in use", contradiction 9); package.json; eslint.config.mjs.
