/* Gradient Reader — the specimen.
 *
 * Paints a passage of real prose inside the extension's own pages, using the
 * same engine that paints the web. Shared by the popup and the options page.
 *
 * This exists because of the one thing the research in this area does agree
 * on: there is no configuration that is best for everybody, and individual
 * configurations produce real individual gains. So the extension cannot
 * usefully pick a setting on anyone's behalf — it can only give them
 * something to calibrate against.
 *
 * A swatch is no good for that. Colour on four square pixels tells you nothing
 * about whether you can read with it for an hour, and the whole mechanism only
 * appears at the moment a line wraps. So the specimen is a real paragraph, set
 * at a real reading width, wrapping onto real lines, painted by the real
 * engine. Move the strength slider and what changes is a page of text, which
 * is the only honest preview of a page of text.
 */

(function () {
  'use strict';

  var NS = window.GradientReader;
  var engine = NS.engine;

  /* Lay the text out and colour it.
   *
   *   container  an element to fill. Its computed colour and background are
   *              read as the ink and paper, so whatever CSS the surrounding
   *              page uses is what the specimen is measured against.
   *   text       paragraphs separated by blank lines.
   *   settings   palette, cycle, strength, autoNight.
   *
   * Returns how many visual lines were painted, which is worth showing: a
   * passage that fits on three lines is not showing the reader anything about
   * the return sweep.
   */
  function paint(container, text, settings) {
    container.textContent = '';

    var paragraphs = text.split(/\n\s*\n/);
    var units = [];
    var i;

    /* --- wrap --- */
    for (i = 0; i < paragraphs.length; i++) {
      var body = paragraphs[i].trim();
      if (!body) continue;

      var p = document.createElement('p');
      p.appendChild(document.createTextNode(body));
      container.appendChild(p);

      var spans = engine.wrapTextNode(p.firstChild, 4);
      if (spans.length) units.push({ spans: spans });
    }

    /* --- the page's own colours --- */
    var computed = getComputedStyle(container);
    var ink = engine.parseColour(computed.color) || [27, 27, 26];

    var paper = null;
    var node = container;
    while (node && node.nodeType === 1 && !paper) {
      paper = engine.parseColour(getComputedStyle(node).backgroundColor);
      node = node.parentNode;
    }
    if (!paper) paper = [255, 255, 255];

    var name = settings.palette;
    if (settings.autoNight && engine.isDark(paper)) {
      var palette = NS.palettes.PALETTES[name];
      if (palette && palette.for === 'light') name = 'night';
    } else if (name === 'night' && !engine.isDark(paper)) {
      name = 'blues';
    }

    var ramp = engine.buildRamp(name, ink, paper, settings.cycle);

    /* --- measure, then colour. Reads before writes, same as everywhere. --- */
    for (i = 0; i < units.length; i++) {
      units[i].boxes = engine.readBoxes(units[i].spans);
    }

    var lines = 0;
    for (i = 0; i < units.length; i++) {
      var grouped = engine.groupLines(units[i].boxes);
      lines += grouped.length;
      engine.applyColours(units[i].spans, engine.computeColours(
        units[i].boxes,
        grouped,
        { ramp: ramp, strength: settings.strength / 100, ink: ink }
      ));
    }

    return lines;
  }

  /* A small strip showing one palette's stops, for the palette buttons. Not a
   * substitute for the specimen — just enough to tell the palettes apart in a
   * list. Drawn as a CSS gradient so it costs nothing. */
  function rampCss(name, cycle) {
    var ink = [27, 27, 26];
    var paper = [251, 251, 249];

    if (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) {
      ink = [217, 219, 224];
      paper = [20, 22, 26];
    }

    var ramp = engine.buildRamp(name, ink, paper, cycle);
    var stops = [];
    for (var i = 0; i <= ramp.length; i++) {
      var colour = engine.rgbToCss(ramp[i % ramp.length]);
      stops.push(colour + ' ' + Math.round((i / ramp.length) * 100) + '%');
    }
    return 'linear-gradient(90deg, ' + stops.join(', ') + ')';
  }

  NS.specimen = { paint: paint, rampCss: rampCss };
})();
