# 0018: A check is trusted only after it has been scored

Status: inherited · Date: 2026-11-18

## Decision

A diagnosis of a fault, and any new check, rests on measurement rather than reasoning. A check is scored against real faults before it gates anything, and dropped or demoted when it does not earn its place. Standing results of this: automatic picture detection (`drive.mjs figures`) is a shortlist, not a check, so a book is called free of pictures only after its contact sheets have been looked at; the check for two paragraphs joined across a page turn was built and dropped; the oblique-line pass on a glossary stays a reader's job, with docs/briefs/glossary-oblique.md.

## Why (plain English)

In one review, every fault reasoned about was diagnosed wrongly and every fault measured was diagnosed right first time. A check that has not been scored manufactures confidence: a clean result is worth exactly as much as the last fault it was seen to catch. Picture detection found 1 of 3 plates by ink and 2 of 3 by OCR debris in Isis Unveiled Vol. I; the joined-paragraph check was wrong on five of five; a word list for oblique lines only memorised 24 known cases and a pronoun rule flagged approved prose.

## What we gave up

Quick checks built from intuition. Some gaps stay without an automatic check, named rather than guessed at.

## Rule for agents

Measure a fault (print the boxes, decode the pixels, count) before diagnosing it. Prove a new check or test fails when the fault is put back before trusting it. Do not rebuild the joined-at-turn check or a word-list oblique-line check without a better signal. Never call a book free of pictures from `figures` alone. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 238–242, 1145–1148, 1258–1261, 1326–1363, 1746–1761; docs/PLAN-next.md ("The standing lesson from the review").
