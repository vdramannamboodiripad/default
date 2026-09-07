/* Gradient Reader — the palettes.
 *
 * Data only. No behaviour lives in this file, so it can be read as a table.
 *
 * Every palette here is safe for deuteranopia and protanopia, which between them
 * account for most colour blindness and for roughly 8% of men. That is not a
 * nice-to-have: colour is the only thing this extension does, so a palette that
 * collapses into one hue for some readers is not a palette, it is a bug.
 *
 * Two axes survive deuteranopia and protanopia: blue against yellow, and plain
 * lightness. Everything else collapses towards one of them. So each palette
 * here is built out of one or both, and out of nothing else.
 *
 * That rules out more than it sounds like. Blue against violet reads as an
 * obvious contrast in normal vision and is nearly invisible under both
 * conditions — violet is blue plus the red that these readers do not receive,
 * so the two stops arrive as the same colour. The first draft of this file had
 * exactly that pair in three of its five palettes, and it took measuring it to
 * notice: test/check-engine.js simulates both conditions and fails the build
 * if neighbouring stops end up closer than a comfortable perceptual distance.
 * Run it after touching any colour here.
 *
 * Each palette is a list of colour stops. Stop 0 is always the reading ink
 * itself, so every paragraph begins in the colour the reader already expects and
 * the gradient departs from there rather than shouting from the first word.
 *
 *   "for"   which paper the stops were picked against: 'light', 'dark', 'both'.
 *   "derive" if present, the stops are computed at paint time from the page's own
 *            ink and paper colours instead of being fixed. Only 'mono' does this.
 *   "note"  the colour-vision note shown next to the palette on the options page.
 */

(function () {
  'use strict';

  var PALETTES = {
    blues: {
      label: 'Blues',
      for: 'light',
      stops: ['#1b1b1a', '#2a6ea3', '#20356e', '#387984'],
      note: 'All on the blue side, told apart by lightness rather than hue: ' +
            'a mid blue, a deep navy, a slate teal. The only palette here ' +
            'that stays in one family, and it manages it by alternating light ' +
            'and dark instead of leaning on colours these readers cannot ' +
            'separate.'
    },

    bright: {
      label: 'Bright',
      for: 'light',
      stops: ['#1b1b1a', '#0a58c2', '#8f4700', '#0e6f78'],
      note: 'Strong blue, burnt amber, deep teal. Blue against amber is the ' +
            'one high-contrast pair that survives both conditions intact, ' +
            'which is what makes this the loudest palette that is still safe. ' +
            'Try it well under half strength first.'
    },

    deep: {
      label: 'Deep',
      for: 'light',
      stops: ['#1b1b1a', '#123a63', '#6b4a12', '#1c5f56'],
      note: 'The same three directions as Bright, dulled right down. The ' +
            'closest thing here to ordinary printed text, and the palette to ' +
            'reach for if colour on a page you are working in feels like too ' +
            'much.'
    },

    night: {
      label: 'Night',
      for: 'dark',
      stops: ['#d9dbe0', '#5f9ad4', '#c9a25a', '#54b3a4'],
      note: 'For dark paper: light blue, sand, seafoam. Painting the daytime ' +
            'palettes onto a dark page gives you dark text on a dark ' +
            'background, which is not a subtle effect but an unreadable one. ' +
            'The extension switches to this by itself unless you have chosen ' +
            'otherwise.'
    },

    mono: {
      label: 'Mono',
      for: 'both',
      derive: 'luminance',
      note: 'Lightness only, mixed from whatever ink and paper the page already ' +
            'uses. No hue at all, so it works for every reader including ' +
            'complete colour blindness. It is also the subtlest option, which ' +
            'is often the one people keep.'
    }
  };

  /* The order the palettes appear in the interface. */
  var PALETTE_ORDER = ['blues', 'bright', 'deep', 'night', 'mono'];

  /* How far each mono stop travels from the ink towards the paper.
   *
   * The order alternates far, near, middle rather than climbing steadily, and
   * that is not an aesthetic choice. Lightness is the only thing mono has, so
   * every neighbouring pair in the cycle — including the pair that closes it,
   * which is a different pair at each of the three cycle lengths — has to be
   * far enough apart to read as a change. A steady climb puts two adjacent
   * stops right next to each other at the wrap, and the whole effect
   * disappears for one line in three.
   *
   * The contrast floor in the engine pulls any of these back if a page's own
   * colours make them too faint, so they are written here as the ideal rather
   * than as the limit. */
  var MONO_STEPS = [0, 0.45, 0.12, 0.30];

  var api = {
    PALETTES: PALETTES,
    PALETTE_ORDER: PALETTE_ORDER,
    MONO_STEPS: MONO_STEPS
  };

  /* Two homes for this file: a Chrome content script, where it hangs off a
   * single global, and node, where test/check-engine.js requires it. */
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GradientReader = root.GradientReader || {};
  root.GradientReader.palettes = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
