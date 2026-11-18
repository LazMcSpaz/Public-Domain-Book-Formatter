# 0051: Big files live in Cloudflare R2, not in git

Status: accepted · Date: 2026-11-18

## Decision

Every large file the books need goes into one private Cloudflare R2 bucket, named by its SHA-256 fingerprint, and the shelf records only the fingerprint and where the file is. That covers scans, reference copies, picture originals and the exact files uploaded to KDP. The shelf repository keeps the books' text, decisions and records, which are small.

## Why (plain English)

Git keeps every version of every file for ever. On 18 November 2026 the shelf held about 2 GB of current files and about 3.4 GB of old versions, nearly all of them scans and exported PDFs, and every session downloads it before starting. The books themselves are small: all 28 books' text and decisions come to about 54 MB. R2 holds large files cheaply (the first 10 GB free, then about $0.015 per GB a month, with no charge for downloads), and sessions and the owner's backup can both reach it.

## What we gave up

- **Git LFS (GitHub's large-file storage):** it works inside git, but costs grow with every download, and every session downloads; the app cannot read it easily from the browser.
- **Google Drive:** sessions cannot pull large files out of it.
- **GitHub releases:** a good permanent record, but sessions here have no tool to upload to them.
- **A new repository per book:** it spreads the same large files across many repositories without removing them.

## Rule for agents

Never commit a scan, a reference copy, an export (PDF, EPUB, cover file) or a picture original to the shelf once the bucket exists; put it in R2 and record its fingerprint. Until the bucket exists (cleanup task 3), keep such files on the computer they were made on and do not push them. Do not replace without a new decision record.

## Source

The owner's decision, 18 November 2026, after the measurement above (the rebuild plan on the shelf, section 3.1).
