# Manual tests

`node gradient-reader/test/check-engine.js` covers the arithmetic: that text
comes out of the wrapper exactly as it went in, that the colour ending one line
begins the next, that every palette survives deuteranopia and protanopia, and
that every colour clears 4.5:1 against the paper. 2,800-odd checks, all of them
against the real shipping code.

None of it says the extension works. Injection, find-in-page, screen readers,
copy and paste, React-driven pages, the observers, and every question of whether
any of this is pleasant to read are browser-only. Those are below, and they are
yours — Claude cannot open a browser.

## Setup

1. `chrome://extensions` → **Developer mode** on (top right).
2. **Load unpacked** → select the `gradient-reader` folder.
3. Pin it: puzzle-piece icon → pin.
4. To use the fixtures, on the Gradient Reader card turn on **Allow access to
   file URLs**. Chrome blocks extensions from `file://` pages otherwise, and
   real sites do not need it.

The fixtures are in `test/fixtures/`. Open them with `file://`.

---

## Stage 1 — the two questions that decide everything

**Do these first.** If either fails, the span approach is dead and no amount of
palette work saves it. That is the kill criterion, and it is worth knowing in an
hour rather than after a week of feature work.

Open `test/fixtures/article.html` and turn the gradient on (icon → **Turn on for
this page**).

### C1 — find-in-page

| Step | Expected | Failure |
| --- | --- | --- |
| 1 | Ctrl+F / Cmd+F, type `undifferentiated grey with nothing` | Chrome highlights it and reports 1 match | No match, or a match that highlights only part of the phrase |
| 2 | Type `café` | Matches in the inline-oddities paragraph | No match — the accent got split |
| 3 | Type `नमस्ते` | Matches | No match — a Devanagari cluster got split |
| 4 | Ctrl+F for a phrase that crosses a `<strong>`, e.g. `argument being held in working` | Matches | No match |

The phrase in step 1 is cut into eight or more separate elements once the
gradient is on. Chrome matches across inline element boundaries as long as the
spans stay `display: inline` and nothing extra is inserted between them, which
is what the reset in `content.css` is defending.

### C2 — screen readers

With VoiceOver (Cmd+F5 on macOS) or NVDA, read the first paragraph of the
article.

- **Pass:** whole words. "A page of unbroken prose asks the reader…"
- **Fail:** fragments. "A pa" "ge of" "unbr" "oken". Stop there and fix it
  before anything else — no feature is worth shipping on top of this.

The spans carry no role and no `aria-*` attribute, which is what keeps them
transparent to the accessibility tree. Anything that adds one will break this.

### C3 — copy and paste

Select the first two paragraphs of the article, copy, paste into a plain text
editor.

- No missing spaces between words.
- No doubled spaces.
- No stray characters at chunk boundaries.
- Paragraph breaks intact.

---

## Stage 2 — never break a page

Still on `article.html`, with the gradient on. Every item in this list must be
**completely untouched** — no colour, no change of any kind:

- [ ] The nav bar at the top
- [ ] The headline (`h1`)
- [ ] The `pre` code block
- [ ] The inline `code` spans, which keep their own font and colour
- [ ] The table
- [ ] The form: text input value, textarea contents, the button label
- [ ] The editable box — click into it and type; it must behave normally
- [ ] The maths
- [ ] The grey instructions box (an `aside`)
- [ ] The footer

And these must be **right**:

- [ ] The `<em>`/`<strong>` nesting keeps its italics and bold
- [ ] The superscript `1` and `2` stay superscript and stay on their line
- [ ] The word **disproven** is a link: it has lost its blue and gained an
      underline
- [ ] The phrase painted with `background-clip: text` by the site is legible
      rather than invisible
- [ ] The Arabic paragraph's gradient starts at the **right-hand** word — the
      first in reading order — not the left
- [ ] Emoji are intact: 👍🏽 has its skin tone, 👨‍👩‍👧 is one figure group,
      🇮🇳 is a flag and not two letters
- [ ] The paragraph inside the shadow-DOM card is coloured too

Then:

- [ ] **Turn it off.** The page returns to exactly how it started. Inspect a
      paragraph in DevTools: no `span.gr-c` left anywhere, and the text is one
      text node again.
- [ ] **Console.** Exactly one line from Gradient Reader, giving blocks, visual
      lines, spans and a first-paint time. No errors, no warnings.

---

## Stage 3 — performance

Open `test/fixtures/long.html` (3,045 words).

| Check | Budget |
| --- | --- |
| First paint, from the console line | under **100ms** |
| Same number on `article.html`, which is a sixth of the length | within a few ms of it — first paint covers one screenful either way |
| Scrolling to the bottom | stays smooth; new text arrives coloured |
| DevTools → Performance, record while turning it on | no task over ~32ms (two frames) |
| Ctrl+`+` to zoom, three steps | colour re-flows to the new line breaks, no stall |
| Repeat on a throttled CPU (Performance → CPU 4× slowdown) | still no visible hang |

Only the text near the viewport is wrapped, so the first-paint number should be
roughly independent of how long the article is. If it scales with length,
something is processing everything up front.

Also worth doing once on a real long article — a newspaper feature, a long blog
post — because a fixture cannot reproduce the mess of a real page.

---

## Stage 4 — dark pages and moving pages

Open `test/fixtures/dynamic-dark.html`. The instructions are in the page; the
short version:

- [ ] Turning it on switches to the dark-paper palette by itself
- [ ] Switching between **Bright**, **Deep** and **Contrast** in the popup
      changes nothing here — dark pages always get the dark-paper palette, and
      that is deliberate
- [ ] **Append three paragraphs** → they colour within about half a second, and
      nothing already painted changes
- [ ] **Replace the article** → the new text colours
- [ ] **Re-render paragraph 1 in place** → its colour goes, then comes back
      within about half a second. Staying plain means a framework re-render
      loses that paragraph for good.
- [ ] **Insert a word into paragraph 2** → the whole paragraph recolours, the
      new sentence included
- [ ] Narrowing the window re-flows the colour
- [ ] Turning it off returns everything, appended paragraphs included, to plain

---

## Stage 5 — the extension around the engine

- [ ] **Popup.** The specimen paragraph in the popup is coloured and wraps onto
      several lines. Moving the strength slider changes it live.
- [ ] **Live update.** With `article.html` open and treated, open the popup and
      move the strength slider. The article behind it changes as you drag.
- [ ] **Palette buttons.** Each one shows its own ramp in the strip above the
      label.
- [ ] **Keyboard.** Alt+G toggles. Press it on a page that has never been
      treated: it should turn **on**, not off.
- [ ] **Badge.** "on" appears on the icon while a page is treated, and clears
      when you navigate away.
- [ ] **Options page.** Every slider changes the specimen. Width, leading,
      size and font change where the lines break, and the colour must follow.
- [ ] **"Leave the site's font"** and **"Leave the site's colours"** really do
      leave them alone — check on a real site with strong styling.
- [ ] **Always on for this domain.** Tick it in the popup on a news site.
      Chrome asks for permission for that one domain. Grant it, then open a
      different article on the same site in a new tab: it should already be
      coloured, with no click.
- [ ] **Refuse the permission.** Tick it and press Deny. The checkbox comes
      back unticked, the note explains that the button still works, and nothing
      breaks.
- [ ] **Never-fire list.** Open Gmail or a Google Doc with a domain enabled
      elsewhere. Nothing happens by itself. Pressing the button deliberately
      still works.
- [ ] **Sites list.** The domain appears on the options page. **Forget** removes
      it, and `chrome://extensions` → Gradient Reader → **Site access** shows
      the permission has been handed back.
- [ ] **Save a copy / Load a copy.** Round-trips. Domains come back switched
      off, with the note explaining why.
- [ ] **Erase everything.** Clears settings and hands back every site
      permission.
- [ ] **Not available here.** Open `chrome://extensions` and press the icon:
      the popup says so plainly instead of failing silently.

---

## Stage 6 — a React-rendered page

Not covered by any fixture, because the point is somebody else's framework.

Find an article on a site built with React or a similar framework and turn the
gradient on.

- [ ] The text colours, and stays coloured — a framework re-render must not
      wipe it permanently
- [ ] If it does get wiped, it comes back within about half a second, via the
      mutation observer
- [ ] No console errors from the site
- [ ] Interaction still works: menus open, links navigate, nothing is frozen

---

## Stage 7 — the thing this cannot test

None of the above says the gradient **helps**. That is the open question
underneath the whole product, and it is a question about one reader over weeks,
not about code.

The way to answer it is to keep a log: for two weeks, note each article you
start and whether you finished it, with the gradient on. Then two weeks with the
gradient off but the width and leading set the same way. If the gradient does
not beat plain text on completion, the honest conclusion is that the benefit
lives in the legibility controls rather than the colour — which would be worth
knowing, and would change which product this is.
