# Rote — working rules

Chrome extension that stores answers to the questions every job application asks
and fills them into a form with one click. Named for the rote work it removes.

**The owner's JS level is beginner.** Write comments that say what a block does in
plain terms. Prefer explicit `for` loops and named intermediate variables over
chained array methods and clever one-liners.

## Non-negotiable constraints

These are not preferences. Breaking one is a bug, not a tradeoff.

1. **Manifest V3. No dependencies.** Vanilla JS, HTML, CSS only. No build step, no
   bundler, no framework, no npm, no `package.json`. If a dependency ever looks
   necessary, stop and ask the owner first.
2. **Zero network egress.** No `fetch`, no `XMLHttpRequest`, no `<script src>`
   pointing anywhere but this extension, no CDN links, no web fonts, no
   analytics, no telemetry, no error reporting. All data stays in
   `chrome.storage.local`. The stored profile contains a home address, a phone
   number, and salary expectations. **Any outbound request is a bug.**
3. **Greenhouse and Lever only.** Do not add support, abstractions, config
   layers, or "hooks for later" for Workday, iCIMS, Taleo, SmartRecruiters,
   Ashby, or multi-step wizards. Two platforms is the design.
4. **Explicit keyword rules, never similarity scoring.** No fuzzy matching, no
   edit distance, no embeddings, no weights. Skipping a field is always the
   correct outcome when the match is not certain. Confusing "current CTC" with
   "expected CTC" is the worst possible failure.

## Out of scope — do not build

Resume or PDF parsing. Fuzzy or semantic matching. Learning from corrections.
A pre-fill preview panel. Resume file auto-attachment. Iframe handling. Custom
(non-`<select>`) dropdown handling. Cover letters. Application tracking.
Multiple profiles. Anything that submits a form.

If one of these ever seems essential, say so in one sentence and let the owner
decide. Do not just build it.

## Personal data must never be committed

- The profile lives in `chrome.storage.local`, inside Chrome's own profile
  directory. It is never written into this repo, so there is no answers file
  here to commit by accident.
- `.gitignore` covers exported profile JSON in case an export is saved into the
  repo anyway.
- Fixtures and any example JSON use obviously fake data only. Never paste the
  owner's real answers into a file in this repo.
- Always show the owner `git status` and ask before `git commit`.

## Verification is manual

Claude cannot open a browser, load the extension, or watch it run. Every check
belongs to the owner. So: build test fixtures before the matcher, and after each
stage hand over a numbered manual test script — what to click, what should
happen, what would count as failure. A stage is not done until the owner
confirms it passes.

Fixtures live in `test/fixtures/` and open with `file://`. Testing against live
postings is not an option — it would mean submitting real applications.

To use the `file://` fixtures, "Allow access to file URLs" must be switched on
for Rote in `chrome://extensions`.

## Markup fragility — where this will silently break

Everything below depends on Greenhouse's or Lever's current DOM. None of it is a
contract. When Rote stops filling something, start here.

- **Greenhouse custom questions carry no semantics in their attributes.** Names
  look like `job_application[answers_attributes][3][text_value]` and ids look
  like `question_10021547`. The visible `<label>` text is the *only* usable
  signal for notice period, CTC, years of experience, and so on. If Greenhouse
  changes label wording ("Notice period" → "Availability"), the match is gone
  and nothing will be filled.
- **Greenhouse has two board generations.** The older `boards.greenhouse.io`
  markup and the newer React-rendered `job-boards.greenhouse.io` markup differ.
  Fixtures follow the newer one.
- **React-controlled inputs may revert a plain assignment.** On React-rendered
  boards, `element.value = x` can be undone by React's own state. The workaround
  is to call the native value setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`)
  and then dispatch a bubbling `input` event. This reaches into React internals
  and is the single most likely thing to break on a Greenhouse update.
- **Lever wraps inputs inside `<label>` instead of using `for=`.** Label text is
  found by walking up to an ancestor `<label>`, and the visible text sits in a
  nested `<div class="application-label-inner">`. If Lever flattens or reorders
  that nesting, label association breaks.
- **Lever custom question names are opaque too**: `cards[<uuid>][field0]`. The
  `field0` / `field1` numbering is per-posting, so it can never be matched on —
  label text only.
- **Lever nests the field inside the `<label>`,** so reading the label plainly
  also picks up every dropdown option: the label for "Are you willing to
  relocate?" reads as "Are you willing to relocate? Select one... Yes No".
  `readLabelWords` in fill.js works on a copy of the label with nested fields
  removed. If that function is ever simplified away, dropdown options will start
  tripping exclude words and killing good matches silently.
- **Visibility is checked with `offsetParent === null`.** This is a cheap proxy
  for "the user can see this field". It misidentifies `position: fixed` elements
  and anything inside a collapsed section.
- **Company career sites often embed a Greenhouse board in an `<iframe>`.**
  Iframe handling is out of scope, so Rote will appear to do nothing on those
  pages. Open the `job-boards.greenhouse.io` or `jobs.lever.co` page directly.
- **The `yearsExperience` exclude list contains technology names** to catch "how
  many years of experience in Python?", which has no giveaway wording. That list
  is expected to grow by hand as new ones turn up. It is not an attempt at
  completeness — a missed one means a wrong number in a field, so add to it when
  you see one.

## Deliberate refusals in the matcher

These look like bugs from the outside. They are not — each one is a case where
filling would be a guess:

- Only one rule may match a field. Two matches means skip ("Current & Expected
  CTC" gets neither number).
- The signal search stops at the first level that says anything, even if what it
  says is "excluded". It never falls through to a weaker clue to find a match.
- Dropdowns fill only if an option reads *exactly* like the stored answer. A
  stored "Yes" fills a Yes/No dropdown; a stored "Indian citizen, no sponsorship
  required" does not fill a Yes/No dropdown, and must not.
- `input type="number"` fills only if the answer is a plain number, because a
  number field silently discards "18 LPA".
- A field with a `maxlength` shorter than the answer is skipped rather than
  filled with a truncated answer.
- Fields that already contain something are never overwritten.
