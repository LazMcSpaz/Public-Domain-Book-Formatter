# 0015: Escalation by deterministic cross-checks, never a model's opinion

Status: inherited · Date: 2026-11-18

## Decision

What gets flagged for a person is decided by checks that give the same answer every time: OCR disagreement, word-count drift, structure anomalies, checks across pages, the book checked against itself. OCR confidence is a real probability and is shown as one; every other heuristic is shown as a labelled flag, never as a probability (SPEC §4, "honest tiers"). A flagged gap is resolved without asking only by corroboration: two independent readers (OCR and a fresh look at the pixels) agreeing. If they disagree, or the crop cannot be read, it goes to the person with both readings.

## Why (plain English)

A model's estimate of how sure it is, is not a probability. Filtering the flag list by it means the list is filtered by the same judgement that would have to be wrong for the flag to matter. Corroboration can be checked afterwards; confidence cannot.

## What we gave up

A confidence threshold ("resolve anything 85% sure"), which would be simpler and would close more items automatically. The transcription alone is never enough to resolve anything.

## Rule for agents

Never gate a check, an escalation or a resolution on a model's assessment of its own output, your own included. Never present a heuristic as a probability. Keep a ledger per book of findings raised, confirmed and refuted, so that every check can be scored. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 199–242, 1859–1862; SPEC.md §4 ("Confidence & flags, honest tiers"); docs/CONTROL.md ("What may be decided without asking").
