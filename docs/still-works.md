# Still works: the owner's checklist

_Draft for the owner. Run it before the rebuild starts and after each step that changes how anything behaves. Each step should take a minute._

**How to start:** open the Libri Vetus app from the tablet's Home Screen, connected to the internet.

1. **The shelf** shows every book as a card. Once the catalogue records are in, study books are marked "study".
2. **Open _The Lost Keys of Masonry_ to read.** The text appears in the book's own typeface, and each of the seven plates shows as a picture.
3. **Open a book with waiting queries** (for example _A Modern Panarion_). The first query shows the passage and a crop of the page.
4. **Rule one query you would rule anyway.** Within a minute the book's card shows one fewer waiting.
5. **In the reading view, mark a few words.** Close the app and open it again: the mark is still there.
6. **Ask a session to export _Thought Vibration_ and send you the PDF.** It arrives, with the same number of pages as before.
7. **Ask a session to run the finish check on _The Lost Keys of Masonry_.** It reports the same result as before.

## Known issues

Found before the rebuild started, so they are not blamed on it. First run by the owner on 18 November 2026, on a phone in the Brave browser.

- **Step 2 fails.** _The Lost Keys of Masonry_ opens to read, but its plates do not show. Cause found: the app looks for pictures at the top of the shelf, while 151 of the 152 sit inside their book's folder.
- **Step 3 works, but the crop is small.** The first query of _A Modern Panarion_ shows only a small crop of the text, too little to judge from comfortably.
- **Step 4 fails.** A ruling stays on the device: "1 ruling saved on this device. Could not reach the shelf (Load failed)."
- **Step 5 fails.** A marked passage shows "1 change on this device only" with the same "Load failed". After a refresh the mark is gone from the page, and it never reached the shelf.
- **What steps 4 and 5 share:**
  - The app's last saves from a tablet reached the shelf on 7 October 2026, and the app's saving code has not changed since.
  - "Load failed" is the browser's message for a request that got no answer at all (blocked, or the connection dropped), not a refusal from GitHub.
  - Reading from the shelf still works; the query crop loaded.
