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
 * Each palette is a list of colour stops, and **none of them is the page's ink**.
 * The first draft made stop 0 the ink, on the theory that every paragraph should
 * begin in the colour the reader already expects. In practice that put a fade to
 * near-black on one line in every two, three or four, and the effect read as
 * muddy rather than restrained: the eye saw blue, blue, black instead of three
 * distinct colours. Dropping it doubled the worst-case separation between
 * neighbouring stops — from 20 to 37 on the default palette — and it is the
 * strength slider's job to keep things quiet, by mixing every stop towards the
 * ink. Low strength is how you get calm; an ink stop in the ramp is not.
 *
 * Palettes do not all have the same number of stops. Blue-against-yellow plus
 * lightness only stretches so far, and a fourth genuinely distinct stop is not
 * always available. Where it is not, the palette ships three and the engine
 * gives three even if the reader asked for four. Three real colours beat four
 * where two of them are the same colour.
 *
 *   "for"   which paper the stops were picked against: 'light', 'dark', 'both'.
 *   "derive" if present, the stops are computed at paint time from the page's own
 *            ink and paper colours instead of being fixed. Only 'mono' does this,
 *            and mono is the one palette that does start at the ink, because a
 *            lightness ramp anchored anywhere else is not a lightness ramp.
 *   "note"  the colour-vision note shown next to the palette on the options page.
 */

(function () {
  'use strict';

  var PALETTES = {
    bright: {
      label: 'Bright',
      for: 'light',
      stops: ['#2a6ee0', '#8a4300', '#0f7d6e', '#2b2f5e'],
      note: 'Blue, burnt amber, teal, deep navy. Blue against amber is the ' +
            'one high-contrast pair that survives both conditions completely ' +
            'intact, and the navy earns its place on lightness rather than ' +
            'hue. The most distinct four stops available on light paper — ' +
            'worst-case separation 37, where anything above about 10 reads as ' +
            'a different colour.'
    },

    deep: {
      label: 'Deep',
      for: 'light',
      stops: ['#1a4f8a', '#6e4410', '#1c5f56'],
      note: 'The same three directions as Bright, dulled right down and with ' +
            'the fourth stop dropped rather than faked. The closest thing ' +
            'here to ordinary printed text, and the one to reach for if ' +
            'colour on a page you are working in feels like too much.'
    },

    blues: {
      label: 'Blues',
      for: 'light',
      stops: ['#2a6ea3', '#20356e', '#387984'],
      note: 'A mid blue, a deep navy, a slate teal — one family, told apart ' +
            'by lightness rather than hue. The subtlest of the coloured ' +
            'palettes and the narrowest: separation of 20 against Bright’s ' +
            '37, because staying in one family is most of the budget.'
    },

    night: {
      label: 'Night',
      for: 'dark',
      stops: ['#7ab4f0', '#d9a95e', '#5fc9b4'],
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
      note: 'Lightness only, mixed from whatever ink and paper the page ' +
            'already uses. No hue at all, so it works for every reader, ' +
            'including complete colour blindness. The only palette that ' +
            'starts at your text colour, because a lightness ramp has to ' +
            'start somewhere real. Also the subtlest option, which is often ' +
            'the one people keep.'
    }
  };

  /* The order the palettes appear in the interface, loudest first. */
  var PALETTE_ORDER = ['bright', 'deep', 'blues', 'night', 'mono'];

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
