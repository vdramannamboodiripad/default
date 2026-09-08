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
 *   "for"   which paper the stops were picked against: 'light' or 'dark'.
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

    contrast: {
      label: 'Contrast',
      for: 'light',
      stops: ['#0e2a60', '#a85200', '#175449', '#2a6ee0'],
      note: 'Dark navy, amber, dark teal, blue — and unlike the others, the ' +
            'stops step through four distinct levels of lightness as well as ' +
            'four hues. That makes it the one palette that still works with ' +
            'no colour vision at all, since the light-and-dark rhythm carries ' +
            'the line breaks on its own if the hues collapse. The strongest ' +
            'sense of texture of the three, and the safest.'
    },

    /* Not in the picker. See DARK_PALETTE below. */
    night: {
      label: 'Night',
      for: 'dark',
      stops: ['#7ab4f0', '#d9a95e', '#5fc9b4'],
      note: 'Used automatically on pages that are already dark, whichever ' +
            'palette you picked. Light blue, sand, seafoam.'
    }
  };

  /* The palettes you can choose, loudest first. */
  var PALETTE_ORDER = ['bright', 'deep', 'contrast'];

  /* The palette used on dark pages, whatever the reader chose.
   *
   * This is not a preference and there is no setting for it, because the
   * alternative was measured and cannot be relied on. The obvious
   * simplification is to drop this palette and let the contrast floor lighten
   * whichever palette the reader picked until it reads against a dark
   * background. The floor does lighten them — and it lightens them *together*,
   * towards the same pale ink, so they can converge.
   *
   * Measured on a dark page, worst-case separation between neighbouring stops,
   * where 12 is the bar:
   *
   *   Bright     9.9   collapses — and it is the default
   *   Deep      19.3   survives, washed out
   *   Contrast  37.0   barely notices, because its stops span a wide
   *                    lightness range the floor cannot squeeze together
   *
   * So it is not true that every palette collapses; it is true that the
   * default does, which is enough to make the simplification unsafe. Dark
   * pages get stops chosen for dark paper instead, and one shared set of them
   * is the whole of the complication. If per-palette dark variants are ever
   * wanted, each needs designing and measuring on its own — do not try to
   * compute one. */
  var DARK_PALETTE = 'night';

  var api = {
    PALETTES: PALETTES,
    PALETTE_ORDER: PALETTE_ORDER,
    DARK_PALETTE: DARK_PALETTE
  };

  /* Two homes for this file: a Chrome content script, where it hangs off a
   * single global, and node, where test/check-engine.js requires it. */
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GradientReader = root.GradientReader || {};
  root.GradientReader.palettes = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
