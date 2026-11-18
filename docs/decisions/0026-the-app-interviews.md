# 0026: The app interviews; questions are data

Status: inherited · Date: 2026-11-18

## Decision

The wizard asks the owner questions rather than making him find settings. Each step returns a list of `Question` objects and one renderer (`QuestionView`) shows whatever it gets, with a recommended answer chosen and the evidence attached (a crop, a thumbnail, a sample page), except where the answer must be the editor's own (0008, 0009). A question is asked at the point where the app can help answer it: the title, author and year are asked at the export gate, prefilled from the scan's title page, not at the start as empty boxes. Questions are batched into gates and never asked before they are relevant.

## Why (plain English)

Nobody should need to understand the program's structure to use it. Because questions are data, adding one needs no new screen, the whole flow can be tested without a browser, and the driver and a person see exactly the same gate.

## What we gave up

Custom screens for each question, and a settings page to browse.

## Rule for agents

Add a question by returning it from its step; never build a one-off screen for it. Never ask what the app could find out first, and never ask "is this word right?" without the scan beside it. Group questions by the step's own `group` field, never by reading meaning out of their ids. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 1802–1825, 2281–2295; docs/ARCHITECTURE.md ("Never ask what the app can find out"); README.md ("The design idea").
