# Still works: the owner's checklist

_Draft for the owner. Run it before the rebuild starts and after each step that changes how anything behaves. Each step should take a minute._

Most work now happens through chat sessions (owner's decision, 18 November 2026), so the main checks are things to ask a session. The tablet checks follow, and are secondary.

## Ask a session

**How to start:** open a Claude Code session with both repositories.

1. **"Show me page 40 of _The Lost Keys of Masonry_."** A picture of the page comes back, with its plate where the book prints it.
2. **"Export _Thought Vibration_ and send me the PDF."** It arrives, with the same number of pages as before.
3. **"Is _The Lost Keys of Masonry_ ready to upload?"** The answer lists every check, each marked passed, failed or NOT CHECKED. It never just says "ready".
4. **"What decisions are waiting on _A Modern Panarion_?"** A list comes back, each with the passage and a crop of the page.
5. **"Rule that query as I say."** The ruling appears in the book's rulings sheet on the shelf.

## On the tablet (secondary)

**How to start:** open the Libri Vetus app from the Home Screen, connected to the internet.

6. **The shelf** shows every book as a card.
7. **Open _The Lost Keys of Masonry_ to read.** Its seven plates show.
8. **Rule one query and mark a few words.** Both reach the shelf.

## Known issues

Found before the rebuild started, so they are not blamed on it. First run by the owner on 18 November 2026, on a phone in the Brave browser, with the earlier tablet-only checklist. The owner has said the tablet path need not be robust, so these are logged, not urgent.

- **Tablet step 7 fails (step 2 of the first run).** _The Lost Keys of Masonry_ opens to read, but its plates do not show. Cause found: the app looks for pictures at the top of the shelf, while 151 of the 152 sit inside their book's folder. Cause fixed, pending the owner's run: the app now looks in the book's folder first, then at the top of the shelf ([spec](specs/pictures-beside-the-book.md)). Remove this entry once step 7 passes.
- **The query crop is small (step 3 of the first run).** The first query of _A Modern Panarion_ shows only a small crop of the text, too little to judge from comfortably.
- **Tablet step 8 fails for rulings (step 4 of the first run).** A ruling stays on the device: "1 ruling saved on this device. Could not reach the shelf (Load failed)."
- **Tablet step 8 fails for marks (step 5 of the first run).** A marked passage shows "1 change on this device only" with the same "Load failed". After a refresh the mark is gone from the page, and it never reached the shelf.
- **What the two failures share:**
  - The app's last saves from a tablet reached the shelf on 7 October 2026, and the app's saving code has not changed since.
  - "Load failed" is the browser's message for a request that got no answer at all (blocked, or the connection dropped), not a refusal from GitHub.
  - Reading from the shelf still works; the query crop loaded.
- **The ritual magic works never appear on the shelf.**
  - About 16 works (_Key of Solomon_, _Abramelin_, Agrippa, Barrett's _Magus_ and others) were saved on 9 November to a shelf branch, `ritual-magic-sources`, that was never merged into `main`, the only copy the app reads.
  - They were also saved as source material (scans, archive OCR, comparison transcriptions), not as book folders with cards. So even merged, the app would show no card for them.
