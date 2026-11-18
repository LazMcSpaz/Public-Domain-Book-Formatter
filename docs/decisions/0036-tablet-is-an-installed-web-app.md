# 0036: The tablet app is the web app installed, not a native app

Status: inherited · Date: 2026-11-18

## Decision

The tablet reading app is this same web app added to the Home Screen (a manifest, an icon and a service worker), with no native wrapper. Changes made on the tablet are queued in an outbox and sent to the shelf whenever there is a connection. In the reading view, the mark buttons sit in a bar along the bottom edge of the screen, not in a pop-up beside the selected words.

## Why (plain English)

A Home Screen install gives the icon, the app switcher, offline use and the iOS storage exemption, which is what "an actual app" means here. The one thing a native wrapper would add that reading could use is Apple Pencil input, and the editor reads by dragging a finger, so it is not wanted. iOS draws its own edit menu over selected words and it cannot be suppressed, so a pop-up there was covered on the first real page.

## What we gave up

App Store presence, Files-app integration and Pencil input, and a second build (Capacitor or Tauri) to keep working.

## Rule for agents

Do not propose a native shell unless handwriting turns out to be how the reading wants to be done. Never move the mark buttons back beside the selection. Do not replace without a new decision record.

## Source

docs/archive/CLAUDE-pre-harness.md lines 2733–2766, 2792–2812; docs/PLAN-reading.md ("What is deliberately not done: a native shell").
