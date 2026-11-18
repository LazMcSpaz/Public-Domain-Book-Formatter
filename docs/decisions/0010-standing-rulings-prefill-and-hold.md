# 0010: Standing rulings pre-fill and hold, never settle

Status: inherited · Date: 2026-11-18

## Decision

A standing ruling (made on a class of cases, `pageIndex: null`, with `covers` naming the words it reaches) fills in its decision on each matching query and holds it for the editor's approval; it never settles a query silently. The value travels as `Question.held`, which `defaultAnswers` ignores on purpose. Approval is the Accept button on the question, "Approve all N" at the gate, or `drive.mjs held approve --yes`; each files an ordinary ruling that names the standing ruling it came from.

## Why (plain English)

When standing rulings settled queries silently, nobody looked at the leaf, and the app called those queries settled while the finishing check called them unruled. The editor chose the mechanism in his own words: "pre-filled and held". The work is done for him, and he still sees each case.

## What we gave up

Fully automatic settling, which would be quicker on a long book; one press can still approve every held query. "Approve all" once filed nothing until Next was pressed; it now files at once, and `npm run check:held` asserts it.

## Rule for agents

Put a standing ruling's answer in `Question.held`, never in `defaultValue`; `test/query-gate.test.ts` fails otherwise. Never pass `--yes` to `held approve` unless the editor has said so himself: the flag is his word, never implied. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 396–408, 1554–1558, 3144–3163.
