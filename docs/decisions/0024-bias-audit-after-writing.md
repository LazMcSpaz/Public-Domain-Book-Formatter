# 0024: The editor's prose gets a bias audit after it is written

Status: inherited · Date: 2026-11-18

## Decision

Every introduction, note set and glossary gets an audit after it is written and before it is pushed. `scripts/voice.mjs audit`, built on `auditProse` (`src/core/annotate/audit.ts`), lists every hedge on a sentence about the tradition, hedge ratios, dismissals and banned phrasing, reading directions, long dashes and a reading grade; a non-zero exit means a person reads the flagged passages. Then a reader reads the doctrinal entries end to end for flatness, which no word list can see.

## Why (plain English)

The writer is the one party who cannot judge its own even-handedness: asked, it says yes and means it. The shelf is occult and esoteric books, and the house rule is to state the tradition's teaching plainly, never push, and never quietly deny it; a lean can enter a page without a single argument being made.

## What we gave up

Trusting the writer's own judgement, which would be quicker. No word list can tell an established teaching from a contested claim, so each flagged hedge is a decision for a person.

## Rule for agents

Never accept a writer's assessment of its own tone, your own included. Fix the draft and re-run; never tune the limits to make a draft pass. Code note: run as documented from this repository, the command throws, because two files in `voice/` look like two editor cards; it runs with `--name <pen name> --shelf <shelf>`. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 79–177; harness/sorting/part-7.md, contradiction 1.
