/* Gradient Reader — the engine.
 *
 * This is the whole product. Everything else in the extension is plumbing to
 * get this file pointed at the right text.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * Three passes over a block of prose:
 *
 *   1. WRAP     Split the text into short spans of at most a few characters
 *               each. Long words get broken into pieces so the colour slides
 *               across them instead of jumping a whole word at a time.
 *
 *   2. MEASURE  Read every span's position on screen and group the spans that
 *               share a vertical position into a visual line. Measuring is the
 *               only way to know where the browser actually broke the lines: it
 *               depends on the width of the column, the font, the size and the
 *               zoom level, so it has to be read after layout and can never be
 *               guessed.
 *
 *   3. PAINT    Run visual line i from stop[i] to stop[i+1]. Line i+1 then
 *               starts at stop[i+1], which is the colour line i ended on. So
 *               the last word of one line and the first word of the next are
 *               the same colour, and the eye's return sweep has something
 *               continuous to follow instead of a field of identical grey.
 *
 * That continuity is the entire mechanism. Nothing else here matters as much.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THAT ARE EASY TO BREAK BY ACCIDENT
 *
 * ALL READS BEFORE ALL WRITES. Reading a span's position forces the browser to
 * finish laying the page out. Writing to a span invalidates that layout. If the
 * two are interleaved — read one span, colour it, read the next — the browser
 * re-lays out the entire page thousands of times and the tab freezes. So
 * readBoxes() only reads and applyColours() only writes, and they are never
 * merged into one convenient loop, however much it looks like they could be.
 *
 * THE TEXT MUST COME OUT EXACTLY AS IT WENT IN. Joining the pieces back
 * together has to reproduce the original string character for character —
 * same spaces, same line breaks, nothing added, nothing normalised. That is
 * what keeps Ctrl+F working, keeps copy-paste clean, and keeps a screen reader
 * reading whole words. splitIntoPieces() is checked against this by
 * test/check-engine.js, and it is the one property in this file worth being
 * paranoid about.
 *
 * ---------------------------------------------------------------------------
 * The functions divide into two kinds, and the split is deliberate:
 *
 *   Pure     splitIntoPieces, groupLines, computeColours and the colour maths.
 *            No DOM, no browser. node can run them, so test/check-engine.js
 *            tests the real shipping code rather than a copy of it.
 *
 *   DOM      wrapTextNode, readBoxes, applyColours, unwrap. Thin — each one is
 *            a handful of lines that moves data between the pure functions and
 *            the page.
 */

(function () {
  'use strict';

  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  /* palettes.js loads before this file in the browser; node passes it in. */
  var palettes = (root.GradientReader && root.GradientReader.palettes) ||
                 (typeof require === 'function' ? require('./palettes.js') : null);

  /* The class every wrapped piece carries. Short because it is written onto
   * thousands of elements, and needed so teardown can find them again. */
  var CHUNK_CLASS = 'gr-c';

  /* =========================================================================
   * COLOUR MATHS
   * ========================================================================= */

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* Blend two colours. t = 0 gives all of a, t = 1 gives all of b. */
  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  function rgbToCss(c) {
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  /* Parse whatever getComputedStyle handed us. Browsers give back
   * "rgb(r, g, b)" or "rgba(r, g, b, a)"; a hex only turns up from our own
   * settings. Anything unrecognised returns null so the caller can fall back. */
  function parseColour(text) {
    if (!text) return null;
    text = String(text).trim();

    if (text.charAt(0) === '#') {
      if (text.length === 4) {
        // #abc is shorthand for #aabbcc.
        text = '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
      }
      if (text.length !== 7) return null;
      return hexToRgb(text);
    }

    var numbers = text.match(/-?\d+(\.\d+)?/g);
    if (!numbers || numbers.length < 3) return null;

    // A fully transparent colour tells us nothing about what the reader sees.
    if (numbers.length >= 4 && parseFloat(numbers[3]) === 0) return null;

    return [
      Math.round(parseFloat(numbers[0])),
      Math.round(parseFloat(numbers[1])),
      Math.round(parseFloat(numbers[2]))
    ];
  }

  /* Relative luminance, as the WCAG contrast formula defines it. */
  function luminance(c) {
    var channels = [];
    for (var i = 0; i < 3; i++) {
      var v = c[i] / 255;
      channels.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    }
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    var lighter = Math.max(la, lb);
    var darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function isDark(c) {
    return luminance(c) < 0.5;
  }

  /* =========================================================================
   * THE RAMP
   *
   * Turning a palette into the actual list of colours a page will be painted
   * with. Two things happen here that the palette table cannot do on its own:
   * mono's stops get derived from the page's own ink and paper, and every stop
   * gets pulled back towards the ink until it is readable against the paper.
   * ========================================================================= */

  var MIN_CONTRAST = 4.5;

  /* Pull one colour towards the ink until it clears the contrast floor against
   * the paper. The ink is the page's own text colour, so it always passes; that
   * makes it a safe direction to retreat in.
   *
   * It is what lets a palette be written against plain white and still work on
   * a site with a light grey or cream background, where a stop picked for white
   * would be a shade too faint. */
  function enforceContrast(colour, ink, paper) {
    if (contrastRatio(colour, paper) >= MIN_CONTRAST) return colour;

    // Twenty steps from the wanted colour back to the ink. The first one that
    // clears the floor wins, so we give up as little of the colour as we can.
    for (var step = 1; step <= 20; step++) {
      var pulled = mix(colour, ink, step / 20);
      if (contrastRatio(pulled, paper) >= MIN_CONTRAST) return pulled;
    }
    return ink;
  }

  /* Build the list of colour stops to paint with.
   *
   *   name    key into the palette table
   *   ink     the page's own text colour, as [r, g, b]
   *   paper   the page's own background colour, as [r, g, b]
   *   cycle   how many stops to use: 2, 3 or 4
   */
  function buildRamp(name, ink, paper, cycle) {
    var palette = palettes.PALETTES[name];
    if (!palette) palette = palettes.PALETTES[palettes.PALETTE_ORDER[0]];

    // Every stop is a real colour. The page's own ink is not one of them —
    // see the note at the top of palettes.js: an ink stop in the ramp puts a
    // fade to near-black on one line in every few, and reads as muddy rather
    // than restrained. Quiet is what the strength slider is for, and it gets
    // there by mixing towards the ink rather than by landing on it.
    var wanted = [];
    var i;
    for (i = 0; i < palette.stops.length; i++) {
      wanted.push(hexToRgb(palette.stops[i]));
    }

    // A palette may ship fewer stops than were asked for, where a fourth
    // genuinely distinct one is not available. Three real colours beat four
    // where two of them are the same colour.
    var count = Math.max(2, Math.min(cycle || 3, wanted.length));
    var ramp = [];
    for (i = 0; i < count; i++) {
      ramp.push(enforceContrast(wanted[i], ink, paper));
    }
    return ramp;
  }

  /* =========================================================================
   * PASS 1 — WRAP
   * ========================================================================= */

  /* Split a string into pieces for wrapping.
   *
   * Rules, in order of importance:
   *
   *   1. Joining every piece back together reproduces the input exactly.
   *   2. Whitespace is never put inside a piece that will be wrapped in a span.
   *      It comes back marked `space: true` and the caller leaves it as a plain
   *      text node. Spans that contain spaces are what breaks find-in-page and
   *      leaves copied text full of odd gaps.
   *   3. A piece never splits a character in half. "Character" here means what
   *      a reader would call one — an emoji built from several code points, or
   *      a letter with a combining accent, counts as one and stays whole.
   *   4. Otherwise, pieces are at most `chunkSize` characters long.
   */
  function splitIntoPieces(text, chunkSize) {
    var pieces = [];
    if (!text) return pieces;

    var size = Math.max(1, chunkSize || 4);
    var units = toCharacters(text);
    var i = 0;

    while (i < units.length) {
      if (isSpace(units[i])) {
        // Take the whole run of whitespace as one plain piece.
        var spaceEnd = i;
        while (spaceEnd < units.length && isSpace(units[spaceEnd])) spaceEnd++;
        pieces.push({ text: units.slice(i, spaceEnd).join(''), space: true });
        i = spaceEnd;
      } else {
        // Take up to `size` characters, stopping at the next whitespace.
        var wordEnd = i;
        while (wordEnd < units.length &&
               !isSpace(units[wordEnd]) &&
               wordEnd - i < size) {
          wordEnd++;
        }
        pieces.push({ text: units.slice(i, wordEnd).join(''), space: false });
        i = wordEnd;
      }
    }

    return pieces;
  }

  function isSpace(unit) {
    // One-character test is enough: a cluster starting with whitespace is
    // whitespace, and \s covers tabs, newlines and non-breaking spaces.
    return /\s/.test(unit.charAt(0));
  }

  /* Break a string into the characters a reader would count.
   *
   * The fast path handles plain ASCII, which is most English prose, by treating
   * every byte as its own character. Anything else goes through Intl.Segmenter
   * so that emoji, flags, accented letters written as two code points and
   * Devanagari clusters are not sliced down the middle. Slicing one of those in
   * half does not merely look wrong, it produces a different character. */
  function toCharacters(text) {
    if (/^[\x20-\x7E\t\n\r]*$/.test(text)) return text.split('');

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      var out = [];
      var segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      var iterator = segmenter.segment(text)[Symbol.iterator]();
      var step = iterator.next();
      while (!step.done) {
        out.push(step.value.segment);
        step = iterator.next();
      }
      return out;
    }

    // No Intl.Segmenter. Array.from at least keeps emoji code points whole.
    return Array.from(text);
  }

  /* Replace one text node with its wrapped pieces. Returns the spans created,
   * in reading order. Whitespace goes back as plain text nodes. */
  function wrapTextNode(node, chunkSize) {
    var pieces = splitIntoPieces(node.nodeValue, chunkSize);
    if (!pieces.length) return [];

    var doc = node.ownerDocument;
    var fragment = doc.createDocumentFragment();
    var spans = [];

    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].space) {
        fragment.appendChild(doc.createTextNode(pieces[i].text));
      } else {
        var span = doc.createElement('span');
        span.className = CHUNK_CLASS;
        span.textContent = pieces[i].text;
        fragment.appendChild(span);
        spans.push(span);
      }
    }

    node.parentNode.replaceChild(fragment, node);
    return spans;
  }

  /* Put a block back exactly as it was found: every span becomes its own text
   * node again, then normalize() glues the neighbouring text nodes together.
   * Because wrapping preserved the text character for character, this really
   * does restore the original DOM and not an approximation of it. */
  function unwrap(container) {
    var spans = container.querySelectorAll('span.' + CHUNK_CLASS);
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      var parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(span.ownerDocument.createTextNode(span.textContent), span);
    }
    container.normalize();
  }

  /* =========================================================================
   * PASS 2 — MEASURE
   * ========================================================================= */

  /* Read where every span sits. Reads only — see the note at the top of the
   * file about why this must not also write.
   *
   * Positions are relative to the viewport, which is fine because nothing here
   * compares a span to anything outside its own block, and no scrolling happens
   * in the middle of the loop. */
  function readBoxes(spans) {
    var boxes = new Array(spans.length);
    for (var i = 0; i < spans.length; i++) {
      var rect = spans[i].getBoundingClientRect();
      boxes[i] = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
    }
    return boxes;
  }

  /* Group boxes into visual lines.
   *
   * A line keeps the vertical band of its first span, widened by a third of
   * its own height. A span belongs to that line if its middle falls inside
   * the widened band.
   *
   * Comparing tops does not work: a superscript, a smaller inline font or a
   * `vertical-align` sits at a different top while plainly being on the same
   * line. Comparing middles alone does not work either, for the same reason —
   * a superscript's middle really is higher. Hence the band: generous enough
   * to keep a raised or shrunken span with its line, tight enough that the
   * next line down never falls into it, even at a line height of exactly 1.0
   * where the two bands touch. */
  function groupLines(boxes) {
    var lines = [];
    var current = null;

    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var middle = box.top + box.height / 2;

      var belongs = false;
      if (current !== null) {
        var slack = Math.max(2, (current.bottom - current.top) * 0.35);
        belongs = middle >= current.top - slack && middle <= current.bottom + slack;
      }

      if (belongs) {
        current.to = i;
      } else {
        current = {
          top: box.top,
          bottom: box.top + box.height,
          from: i,
          to: i
        };
        lines.push(current);
      }
    }

    return lines;
  }

  /* =========================================================================
   * PASS 3 — PAINT
   * ========================================================================= */

  /* Work out the colour for every box. Returns an array of CSS colour strings
   * the same length as `boxes`, which applyColours() then writes out.
   *
   * Options:
   *   ramp      the colour stops, from buildRamp()
   *   strength  0 to 1. 0 leaves the text the page's own ink; 1 is full colour.
   *   ink       the page's own text colour, as [r, g, b]
   *
   * Where a span sits along its line is measured between the first and last
   * span's midpoints rather than between the line's outer edges. That makes the
   * first span of every line land at exactly 0 and the last at exactly 1, so
   * the colour a line ends on is precisely the colour the next line starts
   * with. Measuring to the outer edges leaves a small gap at each end, and the
   * gap is at the return sweep, which is the one place the whole idea depends
   * on. It also means right-to-left text needs no special handling: "first" is
   * first in reading order either way.
   */
  function computeColours(boxes, lines, options) {
    var colours = new Array(boxes.length);
    var ramp = options.ramp;
    var strength = options.strength;
    var ink = options.ink;
    var count = ramp.length;

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var from = ramp[li % count];
      var to = ramp[(li + 1) % count];

      var firstBox = boxes[line.from];
      var lastBox = boxes[line.to];
      var firstMid = firstBox.left + firstBox.width / 2;
      var lastMid = lastBox.left + lastBox.width / 2;
      var reach = lastMid - firstMid;

      for (var i = line.from; i <= line.to; i++) {
        var position;
        if (line.from === line.to || reach === 0) {
          // A line with a single span. Give it the colour the previous line
          // ended on, which keeps the return sweep onto it continuous. There
          // is no way to also be continuous with the line after; one span
          // cannot be two colours.
          position = 0;
        } else {
          var mid = boxes[i].left + boxes[i].width / 2;
          position = (mid - firstMid) / reach;
          if (position < 0) position = 0;
          if (position > 1) position = 1;
        }

        var hue = mix(from, to, position);
        colours[i] = rgbToCss(strength >= 1 ? hue : mix(ink, hue, strength));
      }
    }

    // Any span the line grouping never reached keeps the page's own ink.
    for (var j = 0; j < colours.length; j++) {
      if (colours[j] === undefined) colours[j] = rgbToCss(ink);
    }

    return colours;
  }

  /* Write the colours out. Writes only. Setting `color` does not affect layout,
   * so this pass costs one repaint and no reflow however many spans there are. */
  function applyColours(spans, colours) {
    for (var i = 0; i < spans.length; i++) {
      spans[i].style.color = colours[i];
    }
  }

  function clearColours(spans) {
    for (var i = 0; i < spans.length; i++) {
      spans[i].style.color = '';
    }
  }

  /* =========================================================================
   * SIZING
   * ========================================================================= */

  /* How many characters to put in each span.
   *
   * Four is the number that reads well: short enough that the colour moves
   * within a long word, long enough that an average English word becomes one
   * or two spans rather than five.
   *
   * But every span is a DOM node the browser has to lay out and paint, and a
   * very long page can run to hundreds of thousands of them. Past a threshold
   * the honest trade is a slightly coarser gradient over the whole article
   * rather than a fine one that hangs the tab — and coarser everywhere, chosen
   * before any wrapping starts, so the reader never sees the grain change
   * halfway down the page. */
  function chooseChunkSize(totalCharacters, budget) {
    var size = 4;
    while (size < 12 && totalCharacters / size > budget) size++;
    return size;
  }

  /* =========================================================================
   * EXPORTS
   * ========================================================================= */

  var api = {
    CHUNK_CLASS: CHUNK_CLASS,
    MIN_CONTRAST: MIN_CONTRAST,

    // pure
    hexToRgb: hexToRgb,
    mix: mix,
    rgbToCss: rgbToCss,
    parseColour: parseColour,
    luminance: luminance,
    contrastRatio: contrastRatio,
    isDark: isDark,
    enforceContrast: enforceContrast,
    buildRamp: buildRamp,
    splitIntoPieces: splitIntoPieces,
    toCharacters: toCharacters,
    groupLines: groupLines,
    computeColours: computeColours,
    chooseChunkSize: chooseChunkSize,

    // DOM
    wrapTextNode: wrapTextNode,
    unwrap: unwrap,
    readBoxes: readBoxes,
    applyColours: applyColours,
    clearColours: clearColours
  };

  root.GradientReader = root.GradientReader || {};
  root.GradientReader.engine = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
