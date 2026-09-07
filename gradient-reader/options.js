/* Gradient Reader — the settings page.
 *
 * The specimen is the point of this page. Every control writes to
 * chrome.storage.local and then repaints the passage on the right, so the
 * reader is always calibrating against prose rather than against a number.
 *
 * Nothing here reports a reading speed, and nothing here estimates one. That
 * is deliberate and it is not squeamishness: the speed claim is the single
 * thing in this category that has been actively disproven, at n = 2,074 and
 * again in a paper whose title is "No, Bionic Reading does not work." A
 * treatment that changes how text is drawn cannot make anybody faster at
 * understanding it, because visual intake was never the bottleneck. What it
 * can plausibly do is stop you falling off the page — and an article you
 * abandon halfway is read at no words per minute at all. So the number the
 * page shows is how many visual lines the passage broke into, which is the
 * thing the gradient actually acts on.
 */

(function () {
  'use strict';

  var NS = window.GradientReader;
  var settingsApi = NS.settings;
  var specimen = NS.specimen;
  var palettes = NS.palettes;
  var engine = NS.engine;

  /* The calibration passage. Long enough to wrap many times at every width the
   * sliders allow, and about the problem it demonstrates, so reading it is
   * itself the test. */
  var PASSAGE =
    'A page of unbroken prose asks you to do two jobs at once. The first is ' +
    'the one you signed up for: turning marks into words, words into ' +
    'sentences, sentences into an argument you can hold in your head. The ' +
    'second job is bookkeeping. Where am I. Which line was I on. Did I ' +
    'already read this bit, or does it only feel familiar because the ' +
    'sentence before it ended the same way.\n\n' +

    'Nobody notices the second job until it starts failing. Your eyes reach ' +
    'the right-hand margin, drop, and sweep back left across an inch of ' +
    'undifferentiated grey, and there is nothing at the far end to tell them ' +
    'which of four near-identical lines they were meant to land on. Most of ' +
    'the time they land correctly. When they don’t, you read a line ' +
    'twice, or skip one and spend the next sentence quietly confused, and the ' +
    'cost is not the lost second. The cost is that the argument you were ' +
    'holding has slipped, and rebuilding it takes real effort, and after that ' +
    'happens four or five times you close the tab.\n\n' +

    'This is a narrow problem and it has a narrow fix. If the last word of a ' +
    'line and the first word of the next share a colour, the return sweep has ' +
    'a target. Your eye is following a continuous thing rather than jumping ' +
    'into a field of identical marks and hoping. It does not make you a ' +
    'faster reader in any deep sense; the speed of reading is set by how ' +
    'quickly you turn words into meaning, and no amount of colour touches ' +
    'that.\n\n' +

    'What it can plausibly do is stop you from falling off. That is a smaller ' +
    'claim than the one usually made for tools like this, and it is worth ' +
    'separating the two, because the smaller claim is the one that matches ' +
    'what actually goes wrong. An article you abandon halfway is read at no ' +
    'words per minute at all. Against that, a treatment that keeps you on the ' +
    'page to the end is worth more than any percentage improvement in how ' +
    'fast you move through the part you were going to read anyway.\n\n' +

    'So: turn the strength down until you stop consciously noticing the ' +
    'colour. Somewhere below the point where it reads as decoration, and ' +
    'above the point where it does nothing at all, is the setting you can use ' +
    'for an hour. That setting is personal, which is why it is a slider and ' +
    'not a default.';

  var $ = function (id) { return document.getElementById(id); };

  var current = settingsApi.withDefaults(null);
  var sites = {};

  /* ---------------------------------------------------------------------
   * THE SPECIMEN
   * ------------------------------------------------------------------ */

  /* Push the legibility settings into CSS variables, so the specimen is set
   * the way a treated page would be. Zero means "leave alone", and here that
   * means the page's own comfortable defaults rather than the site's. */
  function applyDocStyle() {
    var root = document.documentElement.style;

    root.setProperty('--doc-measure', (current.measure > 0 ? current.measure : 62) + 'ch');
    root.setProperty('--doc-leading', String(current.leading > 0 ? current.leading / 100 : 1.65));
    root.setProperty('--doc-gap', (current.paraGap > 0 ? current.paraGap / 100 : 1.15) + 'em');
    root.setProperty('--doc-size', ((current.size > 0 ? current.size : 100) * 0.19) + 'px');

    var paper = settingsApi.PAPERS[current.paper];
    if (paper) {
      root.setProperty('--doc-paper', paper.paper);
      root.setProperty('--doc-ink', paper.ink);
    } else {
      root.setProperty('--doc-paper', 'var(--paper)');
      root.setProperty('--doc-ink', 'var(--ink)');
    }

    var family = settingsApi.FACES[current.face];
    root.setProperty(
      '--doc-face',
      family || 'Georgia, "Iowan Old Style", "Times New Roman", serif'
    );
  }

  function drawSpecimen() {
    var lines = specimen.paint($('doc'), PASSAGE, current);
    var words = PASSAGE.split(/\s+/).filter(Boolean).length;
    $('meta').textContent =
      words.toLocaleString() + ' words · ' + lines +
      ' visual lines at this width';
  }

  /* A font change has to land before the passage is measured, or the line
   * breaks read as they were a moment ago. Two frames is the reliable wait. */
  function redrawAfterLayout() {
    applyDocStyle();
    requestAnimationFrame(function () {
      requestAnimationFrame(drawSpecimen);
    });
  }

  /* ---------------------------------------------------------------------
   * THE RAIL
   * ------------------------------------------------------------------ */

  function drawPalettes() {
    var host = $('palettes');
    host.textContent = '';

    for (var i = 0; i < palettes.PALETTE_ORDER.length; i++) {
      var name = palettes.PALETTE_ORDER[i];
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(name === current.palette));
      button.dataset.palette = name;

      var strip = document.createElement('span');
      strip.className = 'strip';
      strip.style.backgroundImage = specimen.rampCss(name, current.cycle);
      button.appendChild(strip);
      button.appendChild(document.createTextNode(palettes.PALETTES[name].label));
      host.appendChild(button);
    }
  }

  /* Every slider label says what zero means, because "0" on a width slider is
   * otherwise a nonsense value rather than a decision. */
  function drawControls() {
    $('strength').value = current.strength;
    $('strengthVal').textContent = current.strength + '%';

    $('measure').value = current.measure;
    $('measureVal').textContent = current.measure > 0
      ? current.measure + 'ch' : 'site’s';

    $('leading').value = current.leading;
    $('leadingVal').textContent = current.leading > 0
      ? (current.leading / 100).toFixed(2) : 'site’s';

    $('paraGap').value = current.paraGap;
    $('paraGapVal').textContent = current.paraGap > 0
      ? (current.paraGap / 100).toFixed(2) + 'em' : 'site’s';

    $('size').value = current.size;
    $('sizeVal').textContent = current.size > 0
      ? current.size + '%' : 'site’s';

    $('paper').value = current.paper;
    $('face').value = current.face;
    $('autoNight').checked = !!current.autoNight;
    $('linkUnderline').checked = !!current.linkUnderline;
    $('autoRun').checked = !!current.autoRun;

    var buttons = $('cycle').children;
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('role', 'radio');
      buttons[i].setAttribute(
        'aria-checked',
        String(Number(buttons[i].dataset.cycle) === current.cycle)
      );
    }

    $('faceNote').textContent = faceNote(current.face);
  }

  /* Atkinson Hyperlegible and OpenDyslexic are meant to be bundled rather than
   * linked, so that choosing one never causes a request to a font host. If the
   * files have not been dropped into fonts/ yet, saying so beats silently
   * falling back to Verdana and leaving somebody to wonder why nothing
   * changed. */
  function faceNote(face) {
    if (face !== 'atkinson' && face !== 'opendyslexic') return '';
    var label = settingsApi.FACE_LABELS[face];
    return label + ' is used from your system if you have it installed, and ' +
      'from fonts/ inside the extension if you have added the file there. ' +
      'See fonts/README.md. Nothing is ever fetched from the web.';
  }

  function drawFaceOptions() {
    var select = $('face');
    select.textContent = '';
    var order = ['site', 'serif', 'sans', 'atkinson', 'opendyslexic'];
    for (var i = 0; i < order.length; i++) {
      var option = document.createElement('option');
      option.value = order[i];
      option.textContent = settingsApi.FACE_LABELS[order[i]];
      select.appendChild(option);
    }
  }

  /* ---------------------------------------------------------------------
   * PALETTE CONTACT SHEET
   * ------------------------------------------------------------------ */

  function drawSheet() {
    var host = $('sheet');
    host.textContent = '';

    // Judged against this page's own paper, so the swatches are honest about
    // what the contrast floor does to them here.
    var dark = matchMedia('(prefers-color-scheme: dark)').matches;
    var ink = dark ? [220, 222, 227] : [27, 27, 26];
    var paper = dark ? [22, 24, 28] : [251, 251, 249];

    for (var i = 0; i < palettes.PALETTE_ORDER.length; i++) {
      var name = palettes.PALETTE_ORDER[i];
      var palette = palettes.PALETTES[name];
      var ramp = engine.buildRamp(name, ink, paper, 4);

      var card = document.createElement('div');
      card.className = 'card';

      var title = document.createElement('h3');
      title.textContent = palette.label;
      card.appendChild(title);

      var stops = document.createElement('div');
      stops.className = 'stops';
      for (var j = 0; j < ramp.length; j++) {
        var swatch = document.createElement('span');
        swatch.style.backgroundColor = engine.rgbToCss(ramp[j]);
        stops.appendChild(swatch);
      }
      card.appendChild(stops);

      var note = document.createElement('p');
      note.textContent = palette.note;
      card.appendChild(note);

      host.appendChild(card);
    }
  }

  /* ---------------------------------------------------------------------
   * SITES
   * ------------------------------------------------------------------ */

  function drawSites() {
    var host = $('sites');
    host.textContent = '';

    var hosts = Object.keys(sites).sort();
    if (!hosts.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No domains yet. Turn one on from the popup and it ' +
        'will appear here.';
      host.appendChild(empty);
      return;
    }

    for (var i = 0; i < hosts.length; i++) {
      host.appendChild(siteRow(hosts[i]));
    }
  }

  function siteRow(name) {
    var row = document.createElement('div');
    row.className = 'site';

    var label = document.createElement('span');
    label.className = 'host';
    label.textContent = name;
    row.appendChild(label);

    var tag = document.createElement('span');
    tag.className = 'tag';
    var mode = sites[name].mode || 'unset';
    tag.dataset.mode = mode;
    tag.textContent = mode === 'on' ? 'always on' : 'off here';
    row.appendChild(tag);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Forget';
    remove.addEventListener('click', function () {
      delete sites[name];
      settingsApi.saveSites(sites).then(function () {
        // Hand the permission back at the same time. Holding a permission for
        // a domain that is no longer in the list would be keeping access
        // nobody asked us to keep.
        chrome.permissions.remove({ origins: [settingsApi.originPattern(name)] });
        chrome.runtime.sendMessage({ type: 'sites-changed' });
        drawSites();
      });
    });
    row.appendChild(remove);

    return row;
  }

  /* ---------------------------------------------------------------------
   * WHAT THE EXTENSION CAN REACH
   *
   * Read out of the installed manifest at runtime. A privacy claim written
   * into a page by hand is a promise; the same claim read out of the manifest
   * is a fact, and it will contradict itself out loud if a permission is ever
   * added carelessly.
   * ------------------------------------------------------------------ */

  function drawFacts() {
    var manifest = chrome.runtime.getManifest();
    var host = $('facts');
    host.textContent = '';

    var permissions = (manifest.permissions || []).join(', ') || 'none';
    var optional = (manifest.optional_host_permissions || []).join(', ') || 'none';
    var always = (manifest.host_permissions || []).join(', ') || 'none';

    add('Version', manifest.version);
    add('Permissions', permissions);
    add('Sites it can always read', always);
    add('Sites it may ask about', optional + ' (one domain at a time, when you say so)');

    var granted = document.createElement('dd');
    chrome.permissions.getAll(function (held) {
      var origins = (held.origins || []);
      granted.textContent = origins.length ? origins.join(', ') : 'none';
    });
    var term = document.createElement('dt');
    term.textContent = 'Sites it can read right now';
    host.appendChild(term);
    host.appendChild(granted);

    var claim = document.createElement('dd');
    claim.className = 'good';
    claim.textContent = 'No network permission of any kind is declared, so no ' +
      'request can be made from this extension — including by mistake.';
    var claimTerm = document.createElement('dt');
    claimTerm.textContent = 'Network';
    host.appendChild(claimTerm);
    host.appendChild(claim);

    function add(name, value) {
      var dt = document.createElement('dt');
      dt.textContent = name;
      var dd = document.createElement('dd');
      dd.textContent = value;
      host.appendChild(dt);
      host.appendChild(dd);
    }
  }

  /* ---------------------------------------------------------------------
   * SAVING
   * ------------------------------------------------------------------ */

  var saveTimer = 0;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      settingsApi.saveSettings(current);
    }, 120);
  }

  /* A control that only changes colour: repaint. */
  function onColourChange() {
    drawPalettes();
    drawSpecimen();
    save();
  }

  /* A control that changes where the lines break: restyle, wait for layout,
   * then repaint. */
  function onLayoutChange() {
    redrawAfterLayout();
    save();
  }

  /* ---------------------------------------------------------------------
   * WIRING
   * ------------------------------------------------------------------ */

  $('palettes').addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    current.palette = button.dataset.palette;
    onColourChange();
  });

  $('cycle').addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    current.cycle = Number(button.dataset.cycle);
    drawControls();
    onColourChange();
  });

  $('strength').addEventListener('input', function (event) {
    current.strength = Number(event.target.value);
    $('strengthVal').textContent = current.strength + '%';
    onColourChange();
  });

  var LAYOUT_SLIDERS = ['measure', 'leading', 'paraGap', 'size'];
  for (var i = 0; i < LAYOUT_SLIDERS.length; i++) {
    (function (key) {
      $(key).addEventListener('input', function (event) {
        current[key] = Number(event.target.value);
        drawControls();
        onLayoutChange();
      });
    })(LAYOUT_SLIDERS[i]);
  }

  $('paper').addEventListener('change', function (event) {
    current.paper = event.target.value;
    onLayoutChange();
  });

  $('face').addEventListener('change', function (event) {
    current.face = event.target.value;
    $('faceNote').textContent = faceNote(current.face);
    onLayoutChange();
  });

  $('autoNight').addEventListener('change', function (event) {
    current.autoNight = event.target.checked;
    onColourChange();
  });

  $('linkUnderline').addEventListener('change', function (event) {
    current.linkUnderline = event.target.checked;
    save();
  });

  $('autoRun').addEventListener('change', function (event) {
    current.autoRun = event.target.checked;
    save();
    chrome.runtime.sendMessage({ type: 'sites-changed' });
  });

  $('reset').addEventListener('click', function () {
    current = settingsApi.withDefaults(null);
    settingsApi.saveSettings(current);
    drawPalettes();
    drawControls();
    redrawAfterLayout();
  });

  /* Export writes a Blob straight to a download. Nothing is uploaded and
   * nothing is fetched; the file is built in memory here and handed to
   * Chrome's own download machinery. */
  $('export').addEventListener('click', function () {
    var payload = JSON.stringify({
      what: 'gradient-reader-settings',
      version: chrome.runtime.getManifest().version,
      settings: current,
      sites: sites
    }, null, 2);

    var url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'gradient-reader-settings.json';
    link.click();
    URL.revokeObjectURL(url);
    $('dataNote').textContent = 'Saved to your downloads folder.';
  });

  $('importPick').addEventListener('click', function () {
    $('importFile').click();
  });

  $('importFile').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        $('dataNote').textContent = 'That file is not valid JSON, so nothing ' +
          'was changed.';
        return;
      }

      if (!parsed || parsed.what !== 'gradient-reader-settings') {
        $('dataNote').textContent = 'That does not look like a Gradient ' +
          'Reader file, so nothing was changed.';
        return;
      }

      current = settingsApi.withDefaults(parsed.settings);

      // Site modes come back, but the permissions do not: a permission has to
      // be granted by a person in a click, and a file cannot do that. Any
      // domain in the file will need turning on once from its own popup.
      sites = {};
      if (parsed.sites) {
        for (var host in parsed.sites) {
          if (!Object.prototype.hasOwnProperty.call(parsed.sites, host)) continue;
          sites[host] = { mode: 'off', overrides: parsed.sites[host].overrides };
        }
      }

      Promise.all([
        settingsApi.saveSettings(current),
        settingsApi.saveSites(sites)
      ]).then(function () {
        chrome.runtime.sendMessage({ type: 'sites-changed' });
        drawPalettes();
        drawControls();
        drawSites();
        redrawAfterLayout();
        $('dataNote').textContent = 'Loaded. Domains came back switched off, ' +
          'because granting a permission needs a real click — turn each ' +
          'one on again from its popup.';
      });
    };
    reader.readAsText(file);
    event.target.value = '';
  });

  $('erase').addEventListener('click', function () {
    var patterns = Object.keys(sites).map(settingsApi.originPattern);

    chrome.storage.local.clear().then(function () {
      if (patterns.length) chrome.permissions.remove({ origins: patterns });
      current = settingsApi.withDefaults(null);
      sites = {};
      chrome.runtime.sendMessage({ type: 'sites-changed' });
      drawPalettes();
      drawControls();
      drawSites();
      drawFacts();
      redrawAfterLayout();
      $('dataNote').textContent = 'Erased, and every site permission handed ' +
        'back.';
    });
  });

  /* ---------------------------------------------------------------------
   * START
   * ------------------------------------------------------------------ */

  settingsApi.load().then(function (stored) {
    current = stored.settings;
    sites = stored.sites;

    drawFaceOptions();
    drawPalettes();
    drawControls();
    drawSheet();
    drawSites();
    drawFacts();
    applyDocStyle();
    drawSpecimen();
  });

  // The specimen is measured, so it has to be measured again when the window
  // changes width.
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawSpecimen, 120);
  });

  // Following the system theme means the ink and paper changed, and both feed
  // the contrast floor.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    drawPalettes();
    drawSheet();
    drawSpecimen();
  });
})();
