/* Gradient Reader — settings.
 *
 * The defaults, and the small amount of code that reads and writes them.
 * Everything lives in chrome.storage.local. Nothing is ever sent anywhere: the
 * extension has no network permission in its manifest at all, so it could not
 * send anything even if this file tried to.
 *
 * Two records are stored:
 *
 *   settings   one object of global defaults, the shape of DEFAULTS below.
 *   sites      { "example.com": { mode: "on" | "off", overrides: { ... } } }
 *
 * A site's `overrides` only holds the keys that differ from the global
 * defaults, so changing a default later still moves every site that never
 * disagreed with it.
 *
 * A note on the defaults, because two of them are the whole argument of the
 * product:
 *
 *   strength is 45, not 80. The setting that looks best in a screenshot is
 *   well above the setting anyone can read with for an hour. Shipping the
 *   demo-friendly number would make the extension feel like a toy on day two.
 *
 *   palette is Bright, which is built on blue against amber. Reaching for red
 *   and green is the obvious way to build a high-contrast gradient and it is
 *   also the way to build one that roughly 8% of men cannot see. Blue against
 *   amber is the pair that gives the same contrast and survives.
 */

(function () {
  'use strict';

  /* Declared up here rather than at the bottom because withDefaults reads it.
   * `var` hoisting would have made it work either way, which is exactly the
   * kind of thing not to rely on. */
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  var DEFAULTS = {
    /* --- the gradient --------------------------------------------------- */
    palette: 'bright',
    cycle: 3,          // how many colour stops in the cycle: 2, 3 or 4
    strength: 45,      // percent. 0 leaves the text alone entirely.

    /* --- legibility ------------------------------------------------------
     * 0 means "leave the site's own value alone", which is the default for
     * every one of these. The extension should touch as little of somebody
     * else's page as it can get away with. */
    measure: 0,        // column width in ch
    leading: 0,        // line height, times 100
    paraGap: 0,        // space between paragraphs, times 100, in em
    size: 0,           // text size as a percentage of the site's own
    paper: 'site',     // site | white | sepia | dark
    face: 'site',      // site | serif | sans | atkinson | opendyslexic

    /* --- correctness ------------------------------------------------------ */
    linkUnderline: true,  // links lose their colour to us, so give them an
                          // underline back. Turning this off is for sites that
                          // underline their links already.

    /* --- behaviour -------------------------------------------------------- */
    autoRun: true,        // run by itself on domains you have enabled
    nodeBudget: 40000     // most spans to create on one page before the
                          // gradient is made coarser to fit
  };

  var PAPERS = {
    site:  null,  // leave the page's own colours completely alone
    white: { paper: '#fbfbf9', ink: '#1b1b1a' },
    sepia: { paper: '#f6efe2', ink: '#3d3428' },
    dark:  { paper: '#14161a', ink: '#d9dbe0' }
  };

  var FACES = {
    site: null,
    serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    atkinson: '"GR Atkinson", "Atkinson Hyperlegible", Verdana, sans-serif',
    opendyslexic: '"GR OpenDyslexic", "OpenDyslexic", Verdana, sans-serif'
  };

  var FACE_LABELS = {
    site: 'Leave the site\'s font',
    serif: 'Serif',
    sans: 'Sans',
    atkinson: 'Atkinson Hyperlegible',
    opendyslexic: 'OpenDyslexic'
  };

  /* Take a settings object off storage and fill in anything missing, so an
   * older stored record still works after a new setting is added — or after
   * one is taken away. */
  function withDefaults(stored) {
    var out = {};
    for (var key in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
      out[key] = (stored && stored[key] !== undefined) ? stored[key] : DEFAULTS[key];
    }

    /* A palette that has since been removed, or the dark-paper palette saved
     * back when it was pickable, becomes the default.
     *
     * The engine already falls back safely on an unknown name, so without this
     * the gradient would look right while the popup showed no palette selected
     * at all — the worst kind of small bug, because everything works and
     * nothing makes sense. Looked up lazily because palettes.js loads after
     * this file. */
    var table = root.GradientReader && root.GradientReader.palettes;
    if (table && table.PALETTE_ORDER.indexOf(out.palette) < 0) {
      out.palette = DEFAULTS.palette;
    }

    return out;
  }

  /* The settings that apply on one host: the globals, with that host's
   * overrides laid on top. */
  function forHost(settings, sites, host) {
    var merged = withDefaults(settings);
    var site = sites && sites[host];
    if (site && site.overrides) {
      for (var key in site.overrides) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
          merged[key] = site.overrides[key];
        }
      }
    }
    return merged;
  }

  function modeForHost(sites, host) {
    var site = sites && sites[host];
    return (site && site.mode) || 'unset';
  }

  /* --- storage -----------------------------------------------------------
   * Wrapped in promises so callers can await them. chrome.storage.local in
   * Manifest V3 already returns promises, but keeping the wrapper means this
   * file works the same way from a content script, the popup and the service
   * worker without any of them caring. */

  function load() {
    return chrome.storage.local.get(['settings', 'sites']).then(function (stored) {
      return {
        settings: withDefaults(stored.settings),
        sites: stored.sites || {}
      };
    });
  }

  function saveSettings(settings) {
    return chrome.storage.local.set({ settings: withDefaults(settings) });
  }

  function saveSites(sites) {
    return chrome.storage.local.set({ sites: sites || {} });
  }

  /* The host part of a URL, or null for anything we should never touch:
   * chrome:// pages, the Chrome Web Store, extension pages, about:blank.
   *
   * A file:// URL has no hostname, so local files come back as the placeholder
   * 'file'. That is enough to let the popup work on the test fixtures. It is
   * never a real domain, so isLocalFile() below exists to stop anything trying
   * to request a permission for it — access to local files is granted by
   * Chrome's own "Allow access to file URLs" switch and by nothing else. */
  var LOCAL_FILE = 'file';

  function hostOf(url) {
    if (!url) return null;
    var parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return null;
    }
    if (parsed.protocol === 'file:') return LOCAL_FILE;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname || null;
  }

  function isLocalFile(host) {
    return host === LOCAL_FILE;
  }

  /* The permission pattern for a host. Requesting this is what lets a
   * registered content script run on that domain by itself; without it the
   * extension can only ever act on the tab you are looking at, at the moment
   * you ask it to. */
  function originPattern(host) {
    return '*://' + host + '/*';
  }

  var api = {
    DEFAULTS: DEFAULTS,
    PAPERS: PAPERS,
    FACES: FACES,
    FACE_LABELS: FACE_LABELS,
    withDefaults: withDefaults,
    forHost: forHost,
    modeForHost: modeForHost,
    load: load,
    saveSettings: saveSettings,
    saveSites: saveSites,
    hostOf: hostOf,
    isLocalFile: isLocalFile,
    originPattern: originPattern
  };

  root.GradientReader = root.GradientReader || {};
  root.GradientReader.settings = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
