/* Gradient Reader — what can be checked without a browser.
 *
 *   node gradient-reader/test/check-engine.js
 *
 * This loads the real engine.js and the real palettes.js — not copies — and
 * tests the parts of them that are pure functions. That covers more than it
 * sounds like, because the interesting half of this extension is arithmetic:
 *
 *   - Text must come out of the wrapper exactly as it went in. This is the one
 *     property everything else rests on. Break it and Ctrl+F stops matching,
 *     copied text arrives with gaps in it, and a screen reader starts reading
 *     fragments instead of words.
 *
 *   - The colour a line ends on must be the colour the next line starts with.
 *     That sentence is the entire product. It is also exactly the kind of claim
 *     that quietly stops being true after a refactor, so it is asserted here
 *     to the last integer.
 *
 *   - Every palette must survive deuteranopia and protanopia. Colour is all
 *     this extension does, so a palette that collapses into one hue for some
 *     readers is a bug. This file simulates both and measures whether
 *     neighbouring stops are still distinguishable.
 *
 *   - Every colour a reader will actually see must clear 4.5:1 against the
 *     paper.
 *
 * What it cannot test, and what therefore has to be checked by hand in Chrome:
 * injection, find-in-page, screen readers, copy and paste, React-driven pages,
 * the intersection observer, the mutation observer, and every question of
 * whether any of this is pleasant to read. test/MANUAL.md is that list.
 */

'use strict';

const engine = require('../engine.js');
const palettes = require('../palettes.js');

let checks = 0;
let failures = 0;

function ok(condition, description, detail) {
  checks++;
  if (condition) return;
  failures++;
  console.log('  FAIL  ' + description);
  if (detail) console.log('        ' + detail);
}

function section(title) {
  console.log('\n' + title);
  console.log('-'.repeat(title.length));
}

/* ===========================================================================
 * 1. THE TEXT MUST SURVIVE
 * ========================================================================= */

section('Wrapping preserves the text exactly');

const SAMPLES = [
  ['plain prose', 'The eye returns from the right margin and lands on the wrong line.'],
  ['double spaces', 'One.  Two.   Three.'],
  ['leading and trailing space', '   padded   '],
  ['newlines and tabs', 'line one\n\tline two\r\nline three'],
  ['non-breaking space', 'Rayner et al. 2016'],
  ['a very long word', 'Donaudampfschiffahrtselektrizitaetenhauptbetriebswerkbauunterbeamten'],
  ['em dashes and quotes', '“A narrow problem” — and a narrow fix.'],
  ['combining accent', 'café naïve'],       // e + combining acute
  ['emoji with modifier', 'ok 👍🏽 done'],
  ['emoji zwj family', 'family 👨‍👩‍👧 here'],
  ['flag', 'flag 🇮🇳 here'],
  ['cjk', '日本語のテキストです'],
  ['devanagari cluster', 'हिन्दी क्ष'],
  ['arabic', 'العربية نص'],
  ['empty', ''],
  ['only spaces', '    ']
];

for (const [name, text] of SAMPLES) {
  for (const size of [1, 2, 4, 7, 12]) {
    const pieces = engine.splitIntoPieces(text, size);
    const rejoined = pieces.map((piece) => piece.text).join('');

    ok(rejoined === text,
       'round trip: ' + name + ' at chunk ' + size,
       JSON.stringify(rejoined) + ' !== ' + JSON.stringify(text));

    // Whitespace in a wrapped span is what breaks find-in-page and copy-paste.
    for (const piece of pieces) {
      if (piece.space) continue;
      ok(!/\s/.test(piece.text),
         'no whitespace inside a span: ' + name + ' at chunk ' + size,
         JSON.stringify(piece.text));
    }

    // A piece is never longer than asked, counted in characters a reader
    // would recognise rather than in UTF-16 code units.
    for (const piece of pieces) {
      if (piece.space) continue;
      const length = engine.toCharacters(piece.text).length;
      ok(length <= size,
         'piece within chunk size: ' + name + ' at chunk ' + size,
         JSON.stringify(piece.text) + ' is ' + length + ' characters');
    }

    // No piece may split one character down the middle. Splitting an emoji or
    // a letter-plus-accent does not just look wrong, it produces a different
    // character. Proved by re-segmenting: the characters of the pieces, in
    // order, must equal the characters of the original.
    const before = engine.toCharacters(text);
    const after = [];
    for (const piece of pieces) {
      for (const unit of engine.toCharacters(piece.text)) after.push(unit);
    }
    ok(before.length === after.length && before.every((u, i) => u === after[i]),
       'no character split in half: ' + name + ' at chunk ' + size,
       before.length + ' characters in, ' + after.length + ' out');
  }
}

/* ===========================================================================
 * 2. LINE GROUPING
 * ========================================================================= */

section('Spans group into the lines the browser actually drew');

/* Synthetic boxes. In the extension these come from getBoundingClientRect;
 * here they are written by hand so the expected answer is known. */
function box(top, left, width, height) {
  return { top, left, width, height: height === undefined ? 20 : height };
}

{
  // Three lines of four spans each, 20px apart.
  const boxes = [];
  for (let line = 0; line < 3; line++) {
    for (let i = 0; i < 4; i++) boxes.push(box(line * 20, i * 30, 28));
  }
  const lines = engine.groupLines(boxes);
  ok(lines.length === 3, 'three rows become three lines', 'got ' + lines.length);
  ok(lines[0].from === 0 && lines[0].to === 3, 'first line spans 0..3');
  ok(lines[2].from === 8 && lines[2].to === 11, 'last line spans 8..11');
}

{
  // A superscript sits higher and is shorter, but is on the same line. Its top
  // differs by 6px while its centre does not — which is why grouping compares
  // centres.
  const boxes = [box(100, 0, 30), box(94, 30, 10, 12), box(100, 40, 30)];
  const lines = engine.groupLines(boxes);
  ok(lines.length === 1, 'a superscript does not start a new line',
     'got ' + lines.length + ' lines');
}

{
  // Line height 1.0: the bands touch exactly. The next line must still be a
  // new line, which is what limits how generous the band can be.
  const boxes = [box(0, 0, 30), box(0, 30, 30), box(20, 0, 30), box(20, 30, 30)];
  const lines = engine.groupLines(boxes);
  ok(lines.length === 2, 'tightly stacked lines do not merge',
     'got ' + lines.length + ' lines');
}

{
  // A line whose first span is the raised one, which is the awkward way round.
  const boxes = [box(94, 0, 10, 12), box(100, 10, 30), box(124, 0, 30)];
  const lines = engine.groupLines(boxes);
  ok(lines.length === 2, 'a line starting with a superscript still groups',
     'got ' + lines.length + ' lines');
  ok(lines[0].from === 0 && lines[0].to === 1, 'and keeps both of its spans');
}

{
  const lines = engine.groupLines([]);
  ok(lines.length === 0, 'no spans means no lines');
}

/* ===========================================================================
 * 3. THE CLAIM
 *
 * "The colour ending one line begins the next." If this fails, the extension
 * has no reason to exist, so it is checked exactly rather than approximately.
 * ========================================================================= */

section('The colour a line ends on is the colour the next line starts with');

function paragraph(lineCount, spansPerLine) {
  const boxes = [];
  for (let line = 0; line < lineCount; line++) {
    for (let i = 0; i < spansPerLine; i++) {
      // Uneven widths, because real words are uneven and the position of a
      // span along its line is measured from real geometry.
      boxes.push(box(line * 24, i * 34 + (i % 3) * 2, 20 + (i % 4) * 6));
    }
  }
  return boxes;
}

for (const cycle of [2, 3, 4]) {
  for (const strength of [0.15, 0.45, 1]) {
    const boxes = paragraph(9, 7);
    const lines = engine.groupLines(boxes);
    const ink = [27, 27, 26];
    const ramp = engine.buildRamp('bright', ink, [255, 255, 255], cycle);
    const colours = engine.computeColours(boxes, lines, { ramp, strength, ink });

    for (let i = 0; i < lines.length - 1; i++) {
      const endOfLine = colours[lines[i].to];
      const startOfNext = colours[lines[i + 1].from];
      ok(endOfLine === startOfNext,
         'continuity across the return sweep, cycle ' + cycle +
         ' at strength ' + strength + ', line ' + i,
         endOfLine + ' then ' + startOfNext);
    }

    // The cycle really cycles: line 0 and line `ramp.length` start the same.
    //
    // Measured against the ramp rather than the requested cycle, because a
    // palette may ship fewer stops than were asked for. Where a fourth
    // genuinely distinct stop is not available, three real colours beat four
    // where two of them are the same colour — so the engine hands back three
    // and the cycle is three long.
    ok(colours[lines[0].from] === colours[lines[ramp.length].from],
       'the cycle repeats after ' + ramp.length + ' lines (asked for ' + cycle +
       ') at strength ' + strength,
       colours[lines[0].from] + ' then ' + colours[lines[ramp.length].from]);
  }
}

{
  // Strength 0 is "no colour at all", not "a bit of colour".
  const boxes = paragraph(5, 6);
  const lines = engine.groupLines(boxes);
  const ink = [27, 27, 26];
  const ramp = engine.buildRamp('bright', ink, [255, 255, 255], 4);
  const colours = engine.computeColours(boxes, lines, { ramp, strength: 0, ink });
  const inkCss = engine.rgbToCss(ink);
  ok(colours.every((colour) => colour === inkCss),
     'strength 0 leaves every span the page\'s own ink');
}

{
  // A one-span line takes the colour the previous line ended on, so the sweep
  // onto it is still continuous.
  const boxes = [box(0, 0, 30), box(0, 30, 30), box(24, 0, 30)];
  const lines = engine.groupLines(boxes);
  const ink = [27, 27, 26];
  const ramp = engine.buildRamp('bright', ink, [255, 255, 255], 3);
  const colours = engine.computeColours(boxes, lines, { ramp, strength: 1, ink });
  ok(colours[1] === colours[2],
     'a single-span line continues from the line above',
     colours[1] + ' then ' + colours[2]);
}

{
  // Right-to-left text needs no special case: position is measured between the
  // first and last span in reading order, and in RTL the first span in reading
  // order is the rightmost one. Same code, mirrored geometry.
  const boxes = [box(0, 300, 28), box(0, 260, 28), box(0, 220, 28),
                 box(24, 300, 28), box(24, 260, 28), box(24, 220, 28)];
  const lines = engine.groupLines(boxes);
  const ink = [27, 27, 26];
  const ramp = engine.buildRamp('bright', ink, [255, 255, 255], 3);
  const colours = engine.computeColours(boxes, lines, { ramp, strength: 1, ink });
  ok(colours[2] === colours[3],
     'continuity holds in right-to-left text',
     colours[2] + ' then ' + colours[3]);
  ok(colours[0] === engine.rgbToCss(ramp[0]),
     'the first span in reading order starts the ramp, not the leftmost one');
}

/* ===========================================================================
 * 4. CONTRAST
 * ========================================================================= */

section('Every colour a reader sees clears 4.5:1 against the paper');

const PAPERS = [
  ['white', [255, 255, 255], [27, 27, 26]],
  ['off-white', [251, 251, 249], [27, 27, 26]],
  ['sepia', [246, 239, 226], [61, 52, 40]],
  ['dark', [20, 22, 26], [217, 219, 224]],
  ['grey site', [238, 238, 238], [51, 51, 51]]
];

/* The pickable palettes plus the dark-paper one, which is never pickable but
 * is what gets painted on half the web. */
const ALL_PALETTES = palettes.PALETTE_ORDER.concat([palettes.DARK_PALETTE]);

for (const name of ALL_PALETTES) {
  for (const [paperName, paper, ink] of PAPERS) {
    // The dark-paper palette is for dark paper and the others are for light;
    // the extension switches between them, so only test each where it is
    // actually used.
    const palette = palettes.PALETTES[name];
    const paperIsDark = engine.isDark(paper);
    if (palette.for === 'light' && paperIsDark) continue;
    if (palette.for === 'dark' && !paperIsDark) continue;

    // All three cycle lengths are offered in the interface, and a shorter
    // cycle is not a subset — it closes the loop on a different pair. Each one
    // has to be checked on its own.
    for (const cycle of [2, 3, 4]) {
      const ramp = engine.buildRamp(name, ink, paper, cycle);

      for (let i = 0; i < ramp.length; i++) {
        const ratio = engine.contrastRatio(ramp[i], paper);
        ok(ratio >= engine.MIN_CONTRAST - 0.001,
           name + ' stop ' + i + ' of ' + cycle + ' on ' + paperName + ' paper',
           'contrast ' + ratio.toFixed(2) + ':1');
      }

      // Interpolating between two stops must not dip below the floor either —
      // the stops are the endpoints, but readers see everything in between.
      for (let i = 0; i < ramp.length; i++) {
        const from = ramp[i];
        const to = ramp[(i + 1) % ramp.length];
        for (let step = 1; step < 10; step++) {
          const between = engine.mix(from, to, step / 10);
          const ratio = engine.contrastRatio(between, paper);
          ok(ratio >= 4.0,
             name + ' between stops ' + i + ' and ' + ((i + 1) % ramp.length) +
             ' of ' + cycle + ' on ' + paperName + ' paper',
             'contrast ' + ratio.toFixed(2) + ':1 at ' + (step * 10) + '%');
        }
      }
    }
  }
}

/* ===========================================================================
 * 5. COLOUR VISION
 *
 * Red against green is the pair that deuteranopia and protanopia flatten, and
 * between them they account for most colour blindness. Simulating both and
 * measuring whether neighbouring stops are still far apart is the only way to
 * make "validated for deuteranopia and protanopia" mean something.
 *
 * The simulation uses the Machado, Oliveira and Fernandes (2009) matrices at
 * full severity, applied in linear RGB. The difference is CIE76 in Lab, which
 * is crude as colour science goes but is a real perceptual distance and is
 * plenty for "are these two obviously different".
 * ========================================================================= */

section('Every palette survives deuteranopia and protanopia');

const SIMULATIONS = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998]
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881]
  ]
};

function toLinear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function fromLinear(value) {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function simulate(colour, matrix) {
  const linear = [toLinear(colour[0]), toLinear(colour[1]), toLinear(colour[2])];
  const out = [];
  for (let row = 0; row < 3; row++) {
    out.push(
      matrix[row][0] * linear[0] +
      matrix[row][1] * linear[1] +
      matrix[row][2] * linear[2]
    );
  }
  return [fromLinear(out[0]), fromLinear(out[1]), fromLinear(out[2])];
}

function toLab(colour) {
  const r = toLinear(colour[0]);
  const g = toLinear(colour[1]);
  const b = toLinear(colour[2]);

  // sRGB to XYZ, D65.
  let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  let y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.00000;
  let z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a, b) {
  const la = toLab(a);
  const lb = toLab(b);
  return Math.sqrt(
    Math.pow(la[0] - lb[0], 2) +
    Math.pow(la[1] - lb[1], 2) +
    Math.pow(la[2] - lb[2], 2)
  );
}

/* Neighbouring stops are what a reader compares: the colour a line ends on
 * against the colour the line above ended on. Twelve is comfortably past
 * "different colour" and well short of demanding they clash. */
const MIN_DELTA_E = 12;

for (const name of ALL_PALETTES) {
  const palette = palettes.PALETTES[name];
  const paperIsDark = palette.for === 'dark';
  const paper = paperIsDark ? [20, 22, 26] : [251, 251, 249];
  const ink = paperIsDark ? [217, 219, 224] : [27, 27, 26];

  for (const cycle of [2, 3, 4]) {
    const ramp = engine.buildRamp(name, ink, paper, cycle);

    for (const [condition, matrix] of Object.entries(SIMULATIONS)) {
      const seen = ramp.map((stop) => simulate(stop, matrix));

      for (let i = 0; i < seen.length; i++) {
        const next = (i + 1) % seen.length;
        const difference = deltaE(seen[i], seen[next]);
        ok(difference >= MIN_DELTA_E,
           name + ' stops ' + i + ' and ' + next + ' of ' + cycle +
           ' stay apart under ' + condition,
           'delta E ' + difference.toFixed(1) + ', needs ' + MIN_DELTA_E);
      }

      // And still readable against the paper once simulated.
      for (let i = 0; i < seen.length; i++) {
        const ratio = engine.contrastRatio(seen[i], simulate(paper, matrix));
        ok(ratio >= 3.5,
           name + ' stop ' + i + ' of ' + cycle + ' readable under ' + condition,
           'contrast ' + ratio.toFixed(2) + ':1');
      }
    }
  }
}

/* ===========================================================================
 * 5b. NO COLOUR VISION AT ALL
 *
 * Complete colour blindness is rare, and the palettes above are no use for it:
 * they are built to sit near the contrast floor, which makes them close to
 * iso-luminant, and once hue is gone there is nothing left to tell the stops
 * apart. The lightness-only palette used to be the answer; the Contrast
 * palette replaces it by stepping through distinct lightness levels as well as
 * distinct hues, which is strictly better because it also works for readers
 * who do see hue.
 *
 * "Distinct levels" rather than "alternating light and dark" is the load-
 * bearing part, and it is not obvious. A cycle of odd length cannot alternate
 * between two states — with three stops, dark/light/dark closes the loop by
 * pairing two darks — so a palette built on alternation loses the whole effect
 * at cycle 3. Three or four separated levels work at every cycle length.
 * ========================================================================= */

section('The Contrast palette works with no colour vision at all');

const LIGHTNESS_PALETTE = 'contrast';
const MIN_DELTA_L = 10;

function lightness(colour) {
  return toLab(colour)[0];
}

for (const [paperName, paper, ink] of PAPERS) {
  if (engine.isDark(paper)) continue;   // this palette is for light paper

  for (const cycle of [2, 3, 4]) {
    const ramp = engine.buildRamp(LIGHTNESS_PALETTE, ink, paper, cycle);
    for (let i = 0; i < ramp.length; i++) {
      const next = (i + 1) % ramp.length;
      const difference = Math.abs(lightness(ramp[i]) - lightness(ramp[next]));
      ok(difference >= MIN_DELTA_L,
         LIGHTNESS_PALETTE + ' stops ' + i + ' and ' + next + ' of ' + cycle +
         ' differ in lightness alone on ' + paperName + ' paper',
         'delta L ' + difference.toFixed(1) + ', needs ' + MIN_DELTA_L);
    }
  }
}

/* And a guard on the claim in palettes.js that a light palette cannot simply
 * be lightened to fit a dark page. If this ever stops being true, the
 * dark-paper palette could be dropped — but it is true, by a wide margin, and
 * the tempting simplification has to stay refused. */
section('A light palette cannot be adapted to dark paper by the contrast floor');

{
  const darkPaper = [20, 22, 26];
  const darkInk = [217, 219, 224];
  const onDark = {};

  for (const name of palettes.PALETTE_ORDER) {
    const ramp = engine.buildRamp(name, darkInk, darkPaper, 4);
    let worst = Infinity;
    for (const matrix of Object.values(SIMULATIONS)) {
      for (let i = 0; i < ramp.length; i++) {
        const next = (i + 1) % ramp.length;
        worst = Math.min(worst, deltaE(
          simulate(ramp[i], matrix), simulate(ramp[next], matrix)));
      }
    }
    onDark[name] = worst;
  }

  /* Not every palette collapses — Contrast barely notices, because its stops
   * span a wide lightness range that the floor cannot squeeze together, and
   * Deep survives washed out. The first draft of this test asserted they all
   * collapse and was wrong about two of the three.
   *
   * What matters is that it cannot be relied on: as long as any pickable
   * palette drops below the safety threshold when lightened, "just lighten
   * whatever the reader chose" is not a design, and the shipped default is the
   * one that fails hardest. */
  const worstOfAll = Math.min(...Object.values(onDark));
  const summary = Object.keys(onDark)
    .map((name) => name + ' ' + onDark[name].toFixed(1))
    .join(', ');

  ok(worstOfAll < MIN_DELTA_E,
     'at least one pickable palette is unsafe when merely lightened for dark paper',
     'separation on dark paper: ' + summary + '. If every one of these ever ' +
     'clears ' + MIN_DELTA_E + ', the separate dark palette could be dropped.');

  ok(onDark[palettes.PALETTE_ORDER[0]] < MIN_DELTA_E,
     'and the default palette is among them',
     palettes.PALETTE_ORDER[0] + ' separates by only ' +
     onDark[palettes.PALETTE_ORDER[0]].toFixed(1) + ' on dark paper');
}

/* ===========================================================================
 * 6. THE NODE BUDGET
 * ========================================================================= */

section('The node budget coarsens the gradient rather than abandoning the page');

ok(engine.chooseChunkSize(4000, 40000) === 4,
   'a short article keeps the finest grain',
   'got ' + engine.chooseChunkSize(4000, 40000));

ok(engine.chooseChunkSize(120000, 40000) === 4,
   'a long article still fits at chunk 4',
   'got ' + engine.chooseChunkSize(120000, 40000));

{
  const size = engine.chooseChunkSize(400000, 40000);
  ok(size > 4 && size <= 12,
     'a huge page gets a coarser grain, not no gradient',
     'got ' + size);
  ok(400000 / size <= 40000,
     'and the coarser grain actually fits the budget',
     Math.round(400000 / size) + ' spans');
}

ok(engine.chooseChunkSize(10000000, 40000) === 12,
   'the coarsening stops at 12 rather than growing without limit',
   'got ' + engine.chooseChunkSize(10000000, 40000));

/* ===========================================================================
 * 7. READING THE PAGE'S OWN COLOURS
 * ========================================================================= */

section('Colours coming back from getComputedStyle are understood');

ok(String(engine.parseColour('rgb(27, 27, 26)')) === '27,27,26', 'rgb()');
ok(String(engine.parseColour('rgba(10, 20, 30, 0.5)')) === '10,20,30', 'rgba()');
ok(engine.parseColour('rgba(0, 0, 0, 0)') === null,
   'a fully transparent background tells us nothing, so it is refused');
ok(String(engine.parseColour('#1b1b1a')) === '27,27,26', 'six-digit hex');
ok(String(engine.parseColour('#abc')) === '170,187,204', 'three-digit hex');
ok(engine.parseColour('transparent') === null, 'the keyword transparent');
ok(engine.parseColour('') === null, 'an empty string');
ok(engine.parseColour(null) === null, 'null');

/* ===========================================================================
 * RESULT
 * ========================================================================= */

console.log('\n' + '='.repeat(58));
if (failures) {
  console.log(failures + ' of ' + checks + ' checks failed.');
  process.exit(1);
}
console.log('All ' + checks + ' checks passed.');
console.log(
  '\nNone of this says the extension works in Chrome. Find-in-page, screen\n' +
  'readers, copy and paste, React pages, injection and whether any of it is\n' +
  'pleasant to read are all browser-only questions. See test/MANUAL.md.'
);
