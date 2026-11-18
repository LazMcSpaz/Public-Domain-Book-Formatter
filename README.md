# Public-Domain Book Formatter

A browser app and a set of scripts that turn public-domain books (scans, born-digital PDFs and EPUBs) into print-ready interiors, covers and EPUBs for Amazon KDP. It reads each page, checks the text against the page image and a second independent reading, puts every editorial question to the editor, adds the editor's introduction, glossary and notes, and lays the book out with its own engine. The preview is the real PDF.

Everything runs on the user's own machine, in the browser. There is no server. The books themselves are kept in a separate git repository the owner controls.

## Run it

```bash
npm install
npm run dev        # the app on http://localhost:5173
npm test           # the automated tests
python3 harness/check.py   # the project's own rules
```

## Find your way

- **What it is for:** [docs/product.md](docs/product.md)
- **How the code is laid out:** [docs/architecture.md](docs/architecture.md)
- **Why it is built this way:** [docs/decisions/](docs/decisions/README.md)
- **How book work is done, job by job:** [docs/process/](docs/process/README.md)
- **Every command:** [docs/reference/commands.md](docs/reference/commands.md)
- **For an AI assistant working here:** [CLAUDE.md](CLAUDE.md)
