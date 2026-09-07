# Gradient Reader — working rules

Chrome extension that colours each line of an article so the colour it ends on
is the colour the next line begins with, giving the eye's return sweep something
continuous to follow. Named for the mechanism, which is the only thing it does.

**The owner's JS level is beginner.** Write comments that say what a block does
in plain terms. Prefer explicit `for` loops and named intermediate variables
over chained array methods and clever one-liners.

## Non-negotiable constraints

These are not preferences. Breaking one is a bug, not a tradeoff.

1. **Manifest V3. No dependencies.** Vanilla JS, HTML, CSS only. No build step,
   no bundler, no framework, no npm, no `package.json`. If a dependency ever
   looks necessary, stop and ask the owner first.
2. **Zero network egress, structurally.** No `fetch`, no `XMLHttpRequest`, no
   `<script src>` pointing anywhere but this extension, no CDN links, no web
   fonts, no analytics, no telemetry, no error reporting. **There is no network
   permission in the manifest and there must never be one.** The claim is not
   "we choose not to send your reading history anywhere", it is "the extension
   has no way to". That is checkable in thirty seconds by anyone who opens
   `manifest.json`, and the options page prints its own permissions so the
   claim contradicts itself out loud if this is ever broken. Any outbound
   request is a bug; a network permission is a worse one.
3. **No blanket host permission.** `activeTab` for the deliberate click, and
   one optional per-origin permission requested from a real click when somebody
   enables a domain. No `<all_urls>` in `host_permissions`, ever. An extension
   that reads every page you visit is this category's worst liability.
4. **Never a speed claim.** No words-per-minute figure anywhere, in the
   interface, in the docs, or internally. Not "about 5 min to read", which is a
   wpm figure wearing a hat. The speed claim is the one thing in this category
   that has been actively disproven, and not making it is the difference between
   a product that ages well and one that doesn't. Completion is what the product
   is for.
5. **No clinical claim.** Describing who reports finding it useful is fine.
   Claiming to treat dyslexia or ADHD is not.
6. **Colour-vision safety is structural.** Colour is the only thing this does.
   Every palette must pass `test/check-engine.js`, which simulates deuteranopia
   and protanopia and fails the build if neighbouring stops collapse together.
   Adding a palette means running that.
7. **Never interrupt.** No nudges, no streaks, no notifications, no on-page
   badge. One line in the console when a page finishes, and nothing else.
8. **Accessibility features are never paywalled.**

## On committing

Rote's rules require showing the owner `git status` and asking before every
commit, because Rote's stored data is a home address, a phone number and salary
expectations. Gradient Reader stores a palette name, a strength percentage and a
line height — preferences, not personal details — so there is nothing here of
that kind to leak. Show `git status` anyway before committing; the reason is now
"so the owner can see what went in", not "so nothing private escapes".

`.gitignore` covers an exported settings file in case one is saved into the repo.

## Out of scope — do not build

Article extraction or a reader mode. PDF, EPUB, mobile. Highlights and notes.
An unfinished-articles shelf. Per-configuration completion reporting.
Summarisation or any LLM feature — it would break constraint 2, which is worth
more than any feature. RSVP one-word-at-a-time. Speed-reading training. Anything
social or gamified.

Also deliberately **not in v1**, though the prototype had both: the resume
ribbon and the read clock. On a static prototype a reading position is a
character offset into one known string. On the live web the text changes under
you, sites restore their own scroll position, and content loads lazily — so the
same feature is a different and much larger problem there, and it would double
the risk surface of a v1 whose central claim is still untested. The prototype
`gradient-reader.html` is the reference if these come back.

If one of these ever seems essential, say so in one sentence and let the owner
decide. Do not just build it.

## The five things most likely to break

1. **Reads and writes must stay separated.** `readBoxes()` only reads
   positions; `applyColours()` only writes them. Merging them into one
   convenient loop makes the browser re-lay-out the page once per span and the
   tab freezes on a long article. This is the single easiest way to ruin this
   extension and it looks like a tidy-up.
2. **The text must come out exactly as it went in.** `splitIntoPieces()` must
   reproduce its input character for character, keep whitespace out of wrapped
   spans, and never split a grapheme cluster. That property is what keeps
   Ctrl+F matching, copy-paste clean, and screen readers reading whole words.
   It is asserted in `test/check-engine.js`; do not weaken those tests to make
   a change pass.
3. **The spans must stay bare.** Plain inline `<span>` with a class and an
   inline `color`. No role, no `aria-*`, no `display` other than inline, no
   `::before`/`::after`, no inserted characters. Adding any of those is what
   makes a screen reader start reading "grad" "ient" and find-in-page stop
   matching across boundaries.
4. **Re-measure, never re-wrap, on reflow.** Wrapping is the expensive half and
   the spans stay correct when lines move. `remeasureAll()` and `repaintAll()`
   are separate for this reason and should stay separate.
5. **The colour cycle restarts at every block.** Not an aesthetic choice —
   blocks are wrapped as they scroll into view, so a continuous count would
   shift colours under the reader. It also happens to read better, because
   there is no return sweep across a paragraph break.

## Markup fragility — where this will silently break

- **`offsetParent` is useless here**, which is why measurement uses
  `getBoundingClientRect()`. On a real page different blocks have different
  offset parents, so `offsetTop` is not comparable between them. The prototype
  could use `offsetTop` because every span shared one parent.
- **Line grouping is a heuristic.** A span joins a line if its middle falls in
  the line's vertical band widened by a third. That keeps superscripts and
  smaller inline fonts with their line and keeps the next line out, including
  at a line height of exactly 1.0. An inline image much taller than the text,
  or a drop cap, can still confuse it.
- **`display: inline !important`** in `content.css` is load-bearing. A site
  rule like `article span { display: inline-block }` would otherwise break
  find-in-page and copy-paste, silently.
- **`-webkit-text-fill-color: currentColor`** is there because sites that do
  gradient headlines set it to `transparent`, which inherits onto our spans and
  makes the colour invisible.
- **A site with `!important` on `color`** beats us and the gradient will not
  appear. There is nothing further to be done about that.
- **Framework re-renders** can wipe the spans. The debounced MutationObserver
  puts them back within about half a second. A framework that re-renders
  continuously will fight this and the honest answer is to turn the extension
  off for that site.
- **`isContentEditable` and the skip list in `detect.js`** are the only things
  standing between this and a corrupted form submission. Additions to that list
  are cheap; removals are not.
- **Article detection is explicit rules and counts,** never a similarity score.
  Where a page is ambiguous the answer is to do nothing, and a list makes it
  obvious why nothing happened. `NEVER_AUTO` will need adding to by hand as
  applications turn up; that list is not an attempt at completeness.
- **The contrast floor is applied to the ramp stops, not to every interpolated
  colour.** Interpolating between two stops that both clear 4.5:1 against the
  same paper stays close to compliant, and the test checks the midpoints, but
  it is an approximation rather than a guarantee.

## Verification is manual

Claude cannot open a browser, load the extension, or watch it run. Every check
that matters belongs to the owner.

`node test/check-engine.js` covers what is arithmetic, and it loads the real
`engine.js` and `palettes.js` rather than a copy — both files export through
`module.exports` when node is what loaded them, and hang off one global when a
content script is. There is no code duplicated between the extension and the
test, which is the point.

Everything else is Chrome-only: injection, find-in-page, screen readers, copy
and paste, React pages, the observers, and whether any of it is pleasant to
read. `test/MANUAL.md` is that list in the order worth doing it, and its first
two items are the kill criterion — if find-in-page and screen readers cannot
both be made to work, the span approach is dead and no amount of palette work
saves it.

A stage is not done until the owner confirms it passes.

## The question underneath all of this

There is an untested n=1 hypothesis here: that gradients fix the owner's
wall-of-text problem. Two weeks of logging — finished or not, gradient on
against gradient off with width and leading held the same — is what would answer
it. If the benefit turns out to sit in the legibility controls rather than the
colour, that changes which product this is, and it is better to learn it early.

Do not let feature work stand in for that answer.
