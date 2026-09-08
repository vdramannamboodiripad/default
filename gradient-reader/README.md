# Gradient Reader

Colours each line of an article so that the colour it ends on is the colour the
next line begins with. When your eye sweeps back from the right margin it has
something continuous to follow instead of a field of near-identical grey lines.

That is the whole idea. Everything else in here is in service of it.

Nothing leaves your computer. There is no network permission in the manifest at
all, so the extension cannot make a request — not that it chooses not to, that
it has no way to. The settings page prints its own permissions so you can check
that rather than take my word for it.

## Install

1. `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → select this `gradient-reader` folder.
3. Pin it to the toolbar: puzzle-piece icon → pin.

Only if you want to try the fixtures in `test/fixtures/`: on the Gradient Reader
card, turn on **Allow access to file URLs**. Chrome blocks extensions from
`file://` pages otherwise. Real sites do not need it.

## Use it

Open a long article and click the icon → **Turn on for this page**. Or press
**Alt+G**, which skips the popup.

The popup holds the three controls worth reaching for often — palette, strength,
number of colours — above a specimen paragraph that changes as you adjust them.
Everything else is on the settings page: right-click the icon → **Options**.

**Turn the strength down.** It ships at 45%, which is already well below the
setting that looks best in a screenshot, and lower still may suit you. The
setting you want is the one you stop noticing after a minute. There is no
configuration that is best for everybody — that is the one finding in this area
that has held up — so the extension ships sliders instead of an opinion.

### Always on for a domain

Tick **Always on for this site** in the popup and Chrome will ask for permission
to read that one domain. Grant it and articles on that site are coloured as they
load, with no click.

Refuse and nothing is lost: the button and Alt+G keep working, one page at a
time, whenever you ask. There is no blanket permission to grant, because the
extension does not have one to ask for.

Mail, documents, boards and chat apps never start by themselves, whatever the
site list says. `detect.js` has the list.

## What it claims

That colour continuity across the return sweep helps you keep your place, so you
fall off long text less often.

**It does not claim to make you read faster**, and neither the interface nor this
file will ever show a words-per-minute figure. That claim is the one thing in
this category that has been actively disproven — no measurable effect across
2,074 participants, and a 2024 *Acta Psychologica* paper titled "No, Bionic
Reading does not work." Visual intake was never the bottleneck: fifty or sixty
milliseconds of word availability is enough for undisrupted reading with full
comprehension, and the rest of the time goes on language processing that no
rendering treatment can touch.

It makes no clinical claim either. Some people who describe themselves as
dyslexic or as having ADHD report finding treatments like this useful. That is a
description of who turns up, not a claim to treat anything.

What is left is smaller and worth more: an article you abandon halfway is read
at no words per minute at all. Completion is the thing.

## Where it will not work

- **Inside an iframe from another site.** Frames on the publisher's own domain
  are treated; a cross-origin frame needs its own permission and usually will
  not have one.
- **Closed shadow roots.** Open ones are handled. Closed ones are, by design,
  not reachable by anybody.
- **Chrome's own pages,** the Web Store, and PDFs. Chrome does not allow it.
- **Enormous pages.** Past a node budget the gradient is made coarser for the
  whole page, and past that the far end of the page is left plain. The console
  says when this happens.

## When something looks wrong

Press F12, open **Console**, and turn the gradient on. It prints one line: how
long the first paint took, and how many blocks, visual lines and spans that
covered. Nothing else, ever — an extension whose job is to help you stay on a
page has no business interrupting you.

The counts are the screenful you are looking at, not the whole article, because
the rest is deliberately left until you scroll to it. That is also what makes
the millisecond figure worth reading: it should be about the same on a 500 word
page and a 5,000 word one. If it grows with the length of the article,
something is processing everything up front and that is a bug.

- **Nothing happened.** The page probably did not look like an article. The
  popup says so. Pressing the button anyway works.
- **Some paragraphs are plain.** Anything inside a nav, a form, a table, a
  `pre`, a code span, an editable box, or marked `aria-hidden` is refused on
  purpose. Breaking a page is worse than not helping.
- **Links are hard to spot.** They should be underlined; if the site fights that,
  turn off **Underline links** and let the site's own styling through.
- **It looks wrong on a dark site.** Dark pages get their own palette
  automatically, whichever one you picked. That is not a preference and there
  is no setting for it: a daytime palette lightened enough to read on black
  loses most of its colour separation, and the default one loses nearly all of
  it. `palettes.js` has the measurements.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3. `storage`, `activeTab`, `scripting`. No host permissions, no network permission. |
| `engine.js` | Wrap, measure, paint. The product. Pure functions where it can be, so `test/check-engine.js` tests the real thing. |
| `palettes.js` | Three palettes you can pick, plus the one used automatically on dark pages. Data only, with the colour-vision reasoning and the numbers behind it. |
| `detect.js` | What counts as an article, and what must never be touched. |
| `content.js` | Runs the engine inside a page: batching, observers, teardown. |
| `content.css` | The defensive reset for the wrapped spans. |
| `settings.js` | Defaults, per-site merging, storage. Shared by every context. |
| `specimen.js` | Paints the calibration passage in the popup and options page. |
| `background.js` | Injection, the keyboard command, per-domain registration, the badge. |
| `popup.html/.css/.js` | Palette, strength, cycle, on/off, always-on. |
| `options.html/.css/.js` | The full calibration surface, palette sheet, site list, permissions readout, export. |
| `fonts/` | Empty. See `fonts/README.md` — Atkinson Hyperlegible and OpenDyslexic go here. |
| `icons/` | Generated by `tools/make-icons.py`. Regenerate rather than editing. |
| `test/check-engine.js` | `node test/check-engine.js` — 2,800 checks on the arithmetic. |
| `test/fixtures/` | An article built to catch mistakes, a 3,000-word page for timing, and a dark page that keeps growing. |
| `test/MANUAL.md` | Everything a browser is needed for. Which is most of it. |

## Verification

`node gradient-reader/test/check-engine.js` proves the parts that are
arithmetic: text survives wrapping exactly, the colour ending one line begins
the next, every palette survives deuteranopia and protanopia, every colour
clears 4.5:1 against the paper.

Everything else — find-in-page, screen readers, copy and paste, React pages,
injection, and whether any of this is actually pleasant to read — needs Chrome
and a person. `test/MANUAL.md` is that list, in the order worth doing it.

The first two items on it are the ones that decide whether the approach is
viable at all.
