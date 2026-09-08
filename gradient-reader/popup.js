/* Gradient Reader — the popup.
 *
 * Everything here writes straight to chrome.storage.local. The content script
 * listens for storage changes rather than for messages from this panel, so a
 * slider moved here updates every treated tab at once and nothing has to know
 * which tab the popup happens to be over.
 */

(function () {
  'use strict';

  var NS = window.GradientReader;
  var settingsApi = NS.settings;
  var specimen = NS.specimen;
  var palettes = NS.palettes;

  /* The specimen text is about the thing it demonstrates, and it is long
   * enough to wrap several times at this width. A shorter passage would sit on
   * two lines and show nothing: the mechanism only exists at the line break. */
  var SPECIMEN =
    'Your eyes reach the right-hand margin, drop, and sweep back left across ' +
    'an inch of undifferentiated grey. There is nothing at the far end to tell ' +
    'them which of four near-identical lines they were meant to land on.\n\n' +
    'If the last word of a line and the first word of the next share a colour, ' +
    'the return sweep has something to aim at.';

  var $ = function (id) { return document.getElementById(id); };

  var page = {
    tabId: null,
    host: null,
    on: false,
    hasArticle: false,
    autoAllowed: true,
    reachable: false,
    // Whether the page answered at all. A page with no content script in it
    // yet cannot tell us whether it is an article, and guessing out loud
    // would be worse than saying nothing.
    probed: false
  };

  var current = settingsApi.DEFAULTS;
  var sites = {};

  /* ---------------------------------------------------------------------
   * DRAWING
   * ------------------------------------------------------------------ */

  function drawSpecimen() {
    specimen.paint($('specimen'), SPECIMEN, current);
  }

  function drawPalettes() {
    var host = $('palettes');
    host.textContent = '';

    for (var i = 0; i < palettes.PALETTE_ORDER.length; i++) {
      var name = palettes.PALETTE_ORDER[i];
      var palette = palettes.PALETTES[name];

      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(name === current.palette));
      button.dataset.palette = name;
      button.title = palette.note;

      var strip = document.createElement('span');
      strip.className = 'strip';
      strip.style.backgroundImage = specimen.rampCss(name, current.cycle);
      button.appendChild(strip);
      button.appendChild(document.createTextNode(palette.label));

      host.appendChild(button);
    }
  }

  function drawControls() {
    $('strength').value = current.strength;
    $('strengthVal').textContent = current.strength + '%';

    var buttons = $('cycle').children;
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('role', 'radio');
      buttons[i].setAttribute(
        'aria-checked',
        String(Number(buttons[i].dataset.cycle) === current.cycle)
      );
    }
  }

  function drawPageState() {
    var where = $('where');
    var toggle = $('toggle');
    var label = $('toggleLabel');
    var hint = $('hint');

    if (!page.reachable) {
      where.textContent = page.host || 'This page';
      toggle.disabled = true;
      label.textContent = 'Not available here';
      hint.textContent = 'Chrome does not let extensions touch this page. ' +
        'Its own pages, the Web Store and PDFs are all off limits.';
      $('always').disabled = true;
      return;
    }

    where.textContent = settingsApi.isLocalFile(page.host)
      ? 'A local file' : (page.host || '');
    toggle.disabled = false;
    toggle.dataset.state = page.on ? 'on' : 'off';
    label.textContent = page.on ? 'Turn off for this page' : 'Turn on for this page';

    if (page.on) {
      hint.textContent = '';
    } else if (page.probed && !page.hasArticle) {
      hint.textContent = 'This page does not look like an article, so there ' +
        'may be little here to colour. Pressing the button anyway is fine.';
    } else {
      hint.textContent = '';
    }

    var local = settingsApi.isLocalFile(page.host);
    $('alwaysHost').textContent = local ? 'local files' : (page.host || 'this site');
    $('always').checked = settingsApi.modeForHost(sites, page.host) === 'on';
    $('always').disabled = !page.host || !page.autoAllowed || local;

    if (local) {
      $('alwaysNote').textContent = 'Local files are not a domain and there is ' +
        'no permission to ask for. Access to them is Chrome\'s own "Allow ' +
        'access to file URLs" switch on the extensions page.';
    } else if (!page.autoAllowed) {
      $('alwaysNote').textContent = 'This domain is on the never-fire list: ' +
        'mail, documents, boards and chat apps. The button still works if you ' +
        'ask for it.';
    }
  }

  /* Everything that comes from storage. Deliberately separate from
   * drawPageState, which is the only part that depends on the tab. */
  function drawSettings() {
    drawPalettes();
    drawControls();
    drawSpecimen();
  }

  /* ---------------------------------------------------------------------
   * SAVING
   *
   * A change made here goes to the global defaults unless this domain already
   * has its own overrides. Somebody who has deliberately tuned one site
   * should not have that undone by reaching for the strength slider on
   * another.
   * ------------------------------------------------------------------ */

  function change(key, value) {
    current[key] = value;

    var site = page.host && sites[page.host];
    if (site && site.overrides &&
        Object.prototype.hasOwnProperty.call(site.overrides, key)) {
      site.overrides[key] = value;
      settingsApi.saveSites(sites);
      return;
    }

    /* Read the globals back, change the one key, write them again.
     *
     * The obvious shortcut — save `current` wholesale — is wrong, because
     * `current` is the globals with this domain's overrides already laid on
     * top. Saving it from a domain that overrides the strength would push that
     * domain's strength out to every other site the moment somebody touched
     * the palette here. */
    chrome.storage.local.get('settings').then(function (stored) {
      var globals = settingsApi.withDefaults(stored.settings);
      globals[key] = value;
      settingsApi.saveSettings(globals);
    });
  }

  /* ---------------------------------------------------------------------
   * WIRING
   * ------------------------------------------------------------------ */

  $('palettes').addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    change('palette', button.dataset.palette);
    drawPalettes();
    drawSpecimen();
  });

  $('strength').addEventListener('input', function (event) {
    current.strength = Number(event.target.value);
    $('strengthVal').textContent = current.strength + '%';
    drawSpecimen();
  });

  // Write on change rather than on every input event, so dragging the slider
  // does not put a hundred records through storage.
  $('strength').addEventListener('change', function (event) {
    change('strength', Number(event.target.value));
  });

  $('cycle').addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    change('cycle', Number(button.dataset.cycle));
    drawControls();
    drawPalettes();
    drawSpecimen();
  });

  $('toggle').addEventListener('click', function () {
    chrome.runtime.sendMessage(
      { type: 'command', tabId: page.tabId, action: page.on ? 'off' : 'on' },
      function (result) {
        if (result) {
          page.on = result.on;
          page.hasArticle = result.hasArticle;
        }
        drawPageState();
      }
    );
  });

  /* "Always on for this domain" is the only place the extension asks for a
   * host permission, and it asks for one domain. permissions.request has to
   * happen inside a real click, which is why it is here and not in
   * background.js. */
  $('always').addEventListener('change', function (event) {
    if (!page.host) return;
    var wanted = event.target.checked;
    var pattern = settingsApi.originPattern(page.host);

    if (!wanted) {
      sites[page.host] = { mode: 'off', overrides: (sites[page.host] || {}).overrides };
      settingsApi.saveSites(sites).then(function () {
        chrome.runtime.sendMessage({ type: 'sites-changed' });
      });
      return;
    }

    chrome.permissions.request({ origins: [pattern] }, function (granted) {
      if (!granted) {
        // Refused. Put the checkbox back and say what still works, rather than
        // asking again.
        event.target.checked = false;
        $('alwaysNote').textContent = 'Permission not granted, which is a ' +
          'perfectly good answer. The button and Alt+G still work on this ' +
          'site, one page at a time.';
        return;
      }

      sites[page.host] = {
        mode: 'on',
        overrides: (sites[page.host] || {}).overrides
      };
      settingsApi.saveSites(sites).then(function () {
        chrome.runtime.sendMessage({ type: 'sites-changed' });
      });
    });
  });

  $('openOptions').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  /* ---------------------------------------------------------------------
   * START
   * ------------------------------------------------------------------ */

  /* Draw as soon as there is anything to draw, and never wait on the page.
   *
   * The first version did the opposite: it asked the tab what it was doing and
   * drew nothing at all until the answer came back. That is why opening the
   * popup felt slow. Two waits were stacked in front of the first pixel — the
   * message round-trip to the content script, and, if the script was there and
   * idle, a full article detection pass that ran on demand inside it.
   *
   * None of the panel needs that answer. The specimen, the palettes and the
   * sliders come from storage and are the whole reason for opening the popup.
   * Only the on/off button's wording depends on the tab, so only that waits,
   * and it waits with a sensible label rather than a blank panel. */
  function start() {
    settingsApi.load().then(function (stored) {
      sites = stored.sites;
      current = settingsApi.withDefaults(stored.settings);
      drawSettings();
      return chrome.tabs.query({ active: true, currentWindow: true });
    }).then(function (tabs) {
      var tab = tabs[0];
      page.tabId = tab ? tab.id : null;
      page.host = tab ? settingsApi.hostOf(tab.url) : null;
      page.reachable = !!page.host;

      // Now that the host is known, per-site overrides may change the controls.
      return chrome.storage.local.get(['settings', 'sites']).then(function (raw) {
        var merged = settingsApi.forHost(raw.settings, raw.sites || {}, page.host);
        var changed = false;
        for (var key in merged) {
          if (Object.prototype.hasOwnProperty.call(merged, key) &&
              merged[key] !== current[key]) {
            changed = true;
          }
        }
        current = merged;
        if (changed) drawSettings();
        drawPageState();
      });
    }).then(function () {
      if (!page.reachable || page.tabId === null) return;

      // Ask the page what it is doing, and update the button when it answers.
      // No answer means no content script yet, which is not an error — it is
      // the normal state of a page nobody has pressed the button on.
      chrome.tabs.sendMessage(page.tabId, { type: 'status' }, function (reply) {
        void chrome.runtime.lastError;
        if (reply && reply.ok) {
          page.probed = true;
          page.on = reply.on;
          page.hasArticle = reply.hasArticle;
          page.autoAllowed = reply.autoAllowed;
        }
        drawPageState();
      });
    });
  }

  start();
})();
