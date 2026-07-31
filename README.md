# Rote

Stores your answers to the questions every job application asks, then fills them
into a Greenhouse or Lever form with one click. Named for the rote work it removes.

Everything stays on your computer. Rote makes no network requests of any kind.

## Install

1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → select this folder.
3. Pin Rote to the toolbar: puzzle-piece icon → pin.

Only if you want to try the practice forms in `test/fixtures/`: on the Rote card,
turn on **Allow access to file URLs**. Chrome blocks extensions from `file://`
pages otherwise. Real job boards don't need it.

## Set up your answers

Right-click the Rote icon → **Options**. Fill in what you want, click **Save
answers**. Anything left blank is simply never filled in.

Two fields cover the same question deliberately:

- **Work authorization status** — the sentence version, for forms with a text box.
- **Work authorization, as a dropdown answer** — put just `Yes` here. The same
  question is often a Yes/No dropdown, where a whole sentence isn't one of the
  options.

## Use it

1. Open a job application page — `job-boards.greenhouse.io`, `boards.greenhouse.io`
   or `jobs.lever.co`.
2. Click the Rote icon.
3. Filled fields glow green for a moment. A box in the corner says how many were
   filled and how many were left alone.
4. **Read the form before submitting.** Rote fills what it is certain about and
   skips the rest, so there will usually be fields left to do by hand.

Click **Undo** in the box to put every filled field back. Undo covers the most
recent fill only, and is lost if the page reloads.

Rote never submits anything. That is deliberate and permanent.

## When a field doesn't fill

That is usually Rote refusing to guess, not a bug. Press F12, open the **Console**
tab, and click the icon again: it prints every field it left alone and why.

Common reasons, all intentional:

- **"ambiguous"** — two answers could fit, e.g. one box asking for both current and
  expected CTC. Rote fills neither.
- **"an exclude word ruled it out"** — the wording was close but carried a
  disqualifying word, like "last drawn salary".
- **"no dropdown option reads exactly …"** — dropdowns fill only on an exact match,
  never on a close one.
- **"this is a number field and … is not a plain number"** — a number field would
  silently throw away "18 LPA".
- **"already has a value"** — Rote never overwrites what you typed.

To teach it a new wording, add a pattern to the right rule in `rules.js`, then
reload Rote in `chrome://extensions`. Your saved answers survive reloads. Check
your change with `node test/check-rules.js`, which prints what the rules would do to
every practice form.

## Backing up

**Export to JSON** on the options page writes your answers to your downloads
folder. That file contains your address, phone number and salary figures in plain
text, so keep it where you'd keep a bank statement — and not in this repo.
**Import from JSON** puts them back.

**Erase all answers** deletes everything Rote has stored. There is no undo.

## If nothing happens at all

- A red **!** on the icon means Chrome refused the page. It blocks its own pages
  (`chrome://…`, the Web Store) and, unless you switched the setting on above,
  `file://` pages.
- Some company career sites show a Greenhouse form inside an iframe. Rote can't see
  into those. Open the `job-boards.greenhouse.io` or `jobs.lever.co` page directly.
- Greenhouse and Lever only. Workday, iCIMS and Taleo are out of scope by design.

## What's in here

| | |
| --- | --- |
| `manifest.json` | Extension setup. No host permissions — nothing runs until you click. |
| `background.js` | Handles the toolbar click. |
| `rules.js` | The keyword table. **Edit this** to teach Rote new wordings. |
| `fill.js` | Matching, filling, highlight, undo. |
| `options.*` | The answers page. |
| `icons/` | Regenerate with `python3 tools/make-icons.py`. |
| `test/fixtures/` | Practice forms — open them instead of applying to real jobs. |
| `test/check-rules.js` | `node test/check-rules.js` — what the rules do to every practice form. |
| `CLAUDE.md` | The rules of the project, and every selector that may break. |
