# Gradient Reader — builds test/fixtures/long.html. Development tool, not part
# of the extension.
#
#   Run it:  python3 gradient-reader/tools/make-long-fixture.py
#
# The performance budget is stated against a 3,000 word article, so there has
# to be a 3,000 word article to state it against. This writes one by repeating a
# handful of real paragraphs under numbered headings, which is honest about
# being repetitive: nobody is meant to read this fixture, only to time it and to
# scroll it.
#
# Repetition is fine for what the file is for. Wrapping cost, layout cost and
# paint cost all scale with the number of spans and the number of visual lines,
# and neither cares whether the words repeat. What the file is not good for is
# judging whether the gradient reads well — use article.html for that, or a real
# page.
#
# Regenerate rather than editing the HTML.

import os

PARAGRAPHS = [
    "A page of unbroken prose asks the reader to do two things at once. The "
    "first is the one they came for: turning marks into words, words into "
    "sentences, and sentences into an argument they can hold in their head "
    "while the next sentence arrives. The second is bookkeeping, and it is "
    "invisible until it fails.",

    "When it fails it fails silently. The eye reaches the right-hand margin, "
    "drops, and sweeps back left across an inch of undifferentiated grey with "
    "nothing at the far end to aim at. Most of the time it lands correctly. "
    "When it does not, a line gets read twice or skipped entirely, and the "
    "argument being held in working memory slips.",

    "Rebuilding a dropped argument costs real effort, and the cost is not the "
    "lost second. After four or five repetitions the reader closes the tab, "
    "and an article abandoned halfway is read at no words per minute at all. "
    "Completion, not speed, is the thing worth measuring.",

    "The claim is narrow on purpose. Colour continuity across the return sweep "
    "may help a reader keep their place, so they fall off long text less "
    "often. It does not make anybody faster at understanding what they read, "
    "because visual intake was never the part that was slow.",

    "Gaze-contingent studies put the useful window of word availability at "
    "fifty or sixty milliseconds, with full comprehension. The remaining time "
    "goes on language processing, which is not something a rendering "
    "treatment can reach. A tool that changes how text is drawn cannot change "
    "how quickly meaning is assembled from it.",

    "What survives the literature is smaller and more useful than the usual "
    "pitch: there is no configuration that is best for everybody, and "
    "individual configurations produce real individual gains. That is an "
    "argument for shipping the controls and declining to have an opinion, "
    "which is exactly what a strength slider is.",

    "Line length and leading decide how hard the return sweep is before any "
    "colour is involved. A column of ninety characters at tight leading is a "
    "harder sweep than a column of sixty at generous leading, and no amount "
    "of colour rescues the first. So the legibility controls are not a "
    "sideshow; they may turn out to be where the benefit actually sits.",

    "An extension that reads the text of every page somebody visits is the "
    "most invasive thing in its category. Making it verifiably local turns "
    "that liability into the strongest line on the listing, and the strongest "
    "form of the claim is not a promise in a privacy policy but the absence "
    "of a network permission in the manifest.",

    "Thousands of small elements, each one measured, is the shape of work that "
    "hangs a tab on mid-range hardware. The way out is to read all the "
    "positions before writing any of the colours, to do it in batches between "
    "idle callbacks, and to touch only the part of the page somebody is "
    "actually looking at.",

    "None of this is settled. Underneath the whole design is an untested "
    "hypothesis about one reader, and the honest next step is not more "
    "engineering but two weeks of logging which articles get finished with "
    "the treatment on and which get finished with it off.",
]

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixture &mdash; %(words)s words, for timing</title>
<style>
  body {
    margin: 0; background: #fbfbf9; color: #23231f;
    font: 17px/1.6 Georgia, "Times New Roman", serif;
  }
  .wrap { max-width: 42rem; margin: 0 auto; padding: 32px 24px 20vh; }
  h1 { font-size: 28px; line-height: 1.25; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 2.2em 0 0.7em; font-family: system-ui, sans-serif; }
  p { margin: 0 0 1.1em; }
  aside {
    margin: 0 0 30px; padding: 14px 16px; background: #f2f2ec;
    border: 1px solid #e0e0d8; font: 13.5px/1.55 system-ui, sans-serif;
  }
  aside p { margin: 0 0 8px; }
  aside p:last-child { margin: 0; }
  code { background: #ebebe4; padding: 1px 4px; font-size: 0.92em; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>%(words)s words, repeating</h1>
</header>

<aside>
  <p><b>This file is for timing and scrolling, not for reading.</b> The
  paragraphs repeat, because wrapping cost and paint cost scale with the number
  of spans and lines and do not care whether the words are new.</p>
  <p><b>First paint</b> should be under 100ms. Turn the gradient on and read the
  line Gradient Reader prints to the console. It reports blocks, visual lines,
  spans and the first-paint time.</p>
  <p><b>Scrolling</b> should stay smooth to the bottom. Only text near the
  viewport is wrapped, so the rest arrives as you reach it &mdash; open the
  Performance panel and look for long tasks if it feels wrong.</p>
  <p><b>Zoom</b> with <code>Ctrl</code> and <code>+</code>. The colour must
  re-flow to the new line breaks without a stall, because a reflow re-measures
  and never re-wraps.</p>
</aside>

<article>
"""

TAIL = """</article>
</div>
</body>
</html>
"""

TARGET_WORDS = 3000


def build():
    body = []
    words = 0
    index = 0
    section = 0

    while words < TARGET_WORDS:
        if index % len(PARAGRAPHS) == 0:
            section += 1
            body.append("<h2>Section %d</h2>" % section)

        paragraph = PARAGRAPHS[index % len(PARAGRAPHS)]
        body.append("<p>%s</p>" % paragraph)
        words += len(paragraph.split())
        index += 1

    return "\n\n".join(body) + "\n", words


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    fixtures = os.path.join(os.path.dirname(here), "test", "fixtures")
    os.makedirs(fixtures, exist_ok=True)

    body, words = build()
    path = os.path.join(fixtures, "long.html")

    with open(path, "w", encoding="utf-8") as handle:
        handle.write(HEAD % {"words": "{:,}".format(words)})
        handle.write(body)
        handle.write(TAIL)

    print("wrote %s (%d words)" % (os.path.relpath(path, os.path.dirname(here)), words))
