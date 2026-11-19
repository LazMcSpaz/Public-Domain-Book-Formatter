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
  - Cause found: the crop held the passage and about one line either side, cut through the middle of lines, and a phone drew it at a fifth of its size (book type about 8 points).
  - Fixed, pending the owner's run ([spec](specs/tablet-saves.md)): every shelf crop is now shown at reading size (book type about 18 points), with a swipe for the rest of the line and "Full size" as before. New crops hold three whole lines either side with the passage marked, and open scrolled to it. _A Modern Panarion_'s crops were cut before this: ask a session to cut them again (`drive.mjs querycrops`) to get the marked, taller ones.
- **Tablet step 8 fails for rulings (step 4 of the first run).** A ruling stays on the device: "1 ruling saved on this device. Could not reach the shelf (Load failed)."
- **Tablet step 8 fails for marks (step 5 of the first run).** A marked passage shows "1 change on this device only" with the same "Load failed". After a refresh the mark is gone from the page, and it never reached the shelf.
- **What the two failures share:**
  - The app's last saves from a tablet reached the shelf on 7 October 2026, and the app's saving code has not changed since.
  - "Load failed" is the browser's message for a request that got no answer at all (blocked, or the connection dropped), not a refusal from GitHub.
  - Reading from the shelf still works; the query crop loaded.
- **What was found (19 November 2026):**
  - Confirmed from the shelf's history: the last writes from the app were on 6 and 7 October, to the _Theosophical Glossary_. Nothing from the app has landed since. The service worker, the saving code and the app's page have not changed since September.
  - Not the size of the book on its own: on 7 October the same code wrote a bigger file than _A Modern Panarion_ many times over.
  - Not proven here. The fault shows only in Safari's engine (every browser on an iPhone or iPad), which this workshop cannot run, and this session cannot write to GitHub to try a write the way the phone does. The candidates that fit every fact: the phone's browser or network refusing or dropping the write; GitHub's answer arriving without the permission header a browser needs; or GitHub taking too long to answer.
  - Found and fixed on the way: after a refresh the app drew the book from the shelf's copy alone, so a mark still waiting to be sent vanished from the page, although it was still kept on the device. And a send wrote the book back without the fields the app does not read: on _Collected Manuscript Lectures_ it would have deleted the reasons on 404 corrections.
- **What changed, pending the owner's run** ([spec](specs/tablet-saves.md)):
  - A failed send now says which request failed (finding the book's folder, reading the book, asking for its version, or writing it), how big it was, how many seconds the browser waited and the browser's own words, and whether reading still works. That sentence is what will find the cause: send a screenshot of it to a session.
  - A write that landed but whose answer was lost counts as sent. A mark waiting to be sent stays on the page after a refresh, whichever way the book is opened. "Send to the shelf" is on the query screen too, and the app tries again on opening the book or the query screen.
  - A send keeps every field it does not read, and the book file's own layout, so the shelf's history shows only the lines that changed. The first version of this still lost the tools' reasons when the change was a comment from the reading view: tried on all 28 shelf books without writing to them, it did so on every one. Fixed: the same trial now keeps every field on all 28. If a send ever cannot keep everything, it writes nothing, keeps your change and says so.
  - A send never writes over a session's save made while it was sending: it checks first, reads the book again and adds your change to the new copy. If GitHub refuses a write because the book was saved elsewhere first, the note says to press "Send to the shelf" (which reads first), not to save over it.
  - A ruling changed, or a note typed, while a send is still on its way stays on the device and goes up next.
  - Worth knowing: a correction you replace with a new one is replaced whole, including the reason and finding the tools wrote on it.
- **The ritual magic works never appear on the shelf.**
  - About 16 works (_Key of Solomon_, _Abramelin_, Agrippa, Barrett's _Magus_ and others) were saved on 9 November to a shelf branch, `ritual-magic-sources`, that was never merged into `main`, the only copy the app reads.
  - They were also saved as source material (scans, archive OCR, comparison transcriptions), not as book folders with cards. So even merged, the app would show no card for them.
