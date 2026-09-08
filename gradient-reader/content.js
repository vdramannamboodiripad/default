/* Gradient Reader — running the engine inside somebody else's page.
 *
 * engine.js knows how to colour a block of prose. This file decides which
 * blocks, in what order, and when to stop. It is the file that has to be
 * careful, because it is the one operating on a document written by a stranger.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF WORK
 *
 * A 3,000 word article is somewhere around 4,000 spans. Creating all of them
 * and measuring all of them in one go takes long enough to drop frames, and
 * "it made every site feel slow" is the most common reason extensions like
 * this get uninstalled. So:
 *
 *   - Every block goes under an IntersectionObserver with a wide margin.
 *     Nothing is wrapped until it is near the viewport. Scrolling brings the
 *     rest in as it becomes relevant.
 *   - Blocks are processed in batches, between idle callbacks, nearest to the
 *     viewport first.
 *   - Each batch is one wrap phase, then one read phase, then one write phase.
 *     Never interleaved. That way a batch costs the browser one layout, not
 *     one layout per span.
 *   - Past a node budget the gradient is made coarser for the whole page
 *     rather than finer for the first half and absent from the rest.
 *
 * ---------------------------------------------------------------------------
 * THE COLOUR CYCLE RESTARTS AT EVERY PARAGRAPH
 *
 * The obvious design is one continuous cycle running down the whole article.
 * It is wrong here for two reasons.
 *
 * The first is correctness. Blocks are treated as they come into view, not in
 * document order, so a paragraph's position in a continuous count is not known
 * until everything above it has been wrapped. Colours would shift under the
 * reader as they scrolled back up.
 *
 * The second is that it reads better. The gradient exists to serve the return
 * sweep — the jump from the end of a line to the start of the next one. There
 * is no return sweep across a paragraph break; the eye drops to an obvious new
 * start. Restarting means every paragraph opens in the page's own ink and the
 * colour departs from there, which looks like a deliberate treatment rather
 * than a wash.
 */

(function () {
  'use strict';

  var NS = window.GradientReader;
  if (!NS || !NS.engine) return;          // a script failed to load; do nothing

  /* One instance per frame. A second injection must not wrap the page twice,
   * so everything after this point runs only once and later injections fall
   * through to the message listener that the first one installed. */
  if (window.__gradientReaderLoaded) return;
  window.__gradientReaderLoaded = true;

  var engine = NS.engine;
  var detect = NS.detect;
  var settingsApi = NS.settings;

  /* How much prose a page needs before it counts as an article.
   *
   * The automatic run has to be sure, because nobody asked it to be there. A
   * deliberate click on the toolbar button has already answered the question of
   * whether the reader wants this here, so it only has to find something worth
   * colouring. */
  var AUTO_MIN_CHARACTERS = 1200;
  var AUTO_MIN_PARAGRAPHS = 5;
  var ASKED_MIN_CHARACTERS = 400;
  var ASKED_MIN_PARAGRAPHS = 2;

  /* How far outside the viewport to start work, and how much to bite off. */
  var LOOKAHEAD = '1200px 0px';
  var BATCH_BLOCKS = 24;
  var BATCH_SPANS = 1400;
  var SLICE_MS = 8;                        // roughly half a frame

  var state = {
    on: false,
    host: settingsApi.hostOf(location.href),
    settings: settingsApi.DEFAULTS,
    mode: 'unset',        // what this domain is set to: on, off or unset
    root: null,
    shadowRoots: [],
    units: [],            // treated blocks: { block, spans, boxes, lines }
    treated: null,        // Set of block elements already done
    queue: [],            // near the viewport, waiting to be wrapped
    entries: null,        // Map of block element -> { block, nodes, characters }
    dirty: [],            // subtrees the page changed, waiting to be looked at
    sawFirstResize: false, // ResizeObserver always fires once on observe
    articleHint: null,    // null until worked out; then true or false
    chunkSize: 4,
    spanCount: 0,
    degraded: false,
    ink: [27, 27, 26],
    paper: [255, 255, 255],
    ramp: null,
    style: null,
    observer: null,
    intersection: null,
    resize: null,
    writing: false,
    timers: { rescan: 0, reflow: 0 },
    idle: null,
    startedAt: 0,
    firstPaintMs: 0,
    reported: false
  };

  /* =========================================================================
   * TURNING ON
   * ========================================================================= */

  /* `asked` is true when a person pressed something, false for the automatic
   * run on a domain they enabled earlier. */
  function turnOn(asked) {
    if (state.on) return true;

    state.startedAt = (performance && performance.now) ? performance.now() : 0;

    var minCharacters = asked ? ASKED_MIN_CHARACTERS : AUTO_MIN_CHARACTERS;
    var minParagraphs = asked ? ASKED_MIN_PARAGRAPHS : AUTO_MIN_PARAGRAPHS;

    if (!asked && !detect.autoRunAllowed(state.host)) return false;

    var root = detect.findArticleRoot(document, minCharacters, minParagraphs);
    if (!root) return false;

    state.root = root;
    state.on = true;
    state.treated = new Set();
    state.entries = new Map();
    state.units = [];
    state.queue = [];
    state.dirty = [];
    state.spanCount = 0;
    state.degraded = false;
    state.reported = false;
    state.firstPaintMs = 0;

    root.classList.add('gr-article');
    document.documentElement.classList.add('gr-on');

    // Style first: it may set the paper theme, which changes what the page's
    // colours are, and the ramp has to be built against the final ones.
    writeStyle();
    readPageColours();
    buildRamp();

    state.shadowRoots = openShadowRootsIn(root);
    for (var i = 0; i < state.shadowRoots.length; i++) {
      injectShadowReset(state.shadowRoots[i]);
    }

    var blocks = gatherBlocks();

    // Decide the span size once, for the whole page, from the total amount of
    // text. Changing it partway down would make the grain of the gradient
    // visibly change as the reader scrolled.
    var characters = 0;
    for (var j = 0; j < blocks.length; j++) characters += blocks[j].characters;
    state.chunkSize = engine.chooseChunkSize(characters, state.settings.nodeBudget);

    // Observers first: startWork paints straight away, and the mutation
    // observer has to exist by then so its record of our own edits can be
    // thrown away rather than coming back as "new content".
    startObservers();
    startWork(blocks);
    announce();
    return true;
  }

  /* Blocks in the article root and in any open shadow roots inside it. */
  function gatherBlocks() {
    var all = detect.collectBlocks(state.root);
    for (var i = 0; i < state.shadowRoots.length; i++) {
      var inner = detect.collectBlocks(state.shadowRoots[i]);
      for (var j = 0; j < inner.length; j++) all.push(inner[j]);
    }
    return register(all);
  }

  /* Keep the blocks nobody has dealt with yet, and remember them so the
   * observers can find their text nodes again later. */
  function register(collected) {
    var fresh = [];
    for (var i = 0; i < collected.length; i++) {
      var block = collected[i].block;
      if (state.treated.has(block)) continue;
      if (state.entries.has(block)) continue;
      state.entries.set(block, collected[i]);
      fresh.push(collected[i]);
    }
    return fresh;
  }

  /* Start work on a fresh set of blocks.
   *
   * The blocks already on screen are treated **now**, synchronously, before
   * this function returns. Everything else is handed to the
   * IntersectionObserver and arrives as the reader scrolls to it.
   *
   * The first version routed everything through the observer and an idle
   * callback, and it felt slow for a reason that had nothing to do with how
   * much work there was: an IntersectionObserver callback does not run until
   * after the next layout, and requestIdleCallback can sit for its whole
   * timeout before firing. Two waits, in front of the one batch of work the
   * reader is looking straight at. A screenful of paragraphs is a few hundred
   * spans and a few milliseconds; making somebody wait two frames and an idle
   * slot for it buys nothing. The lazy path is for the other ten screenfuls,
   * where it is worth everything. */
  function startWork(blocks) {
    if (state.degraded) return;

    // One read pass over the blocks. There are tens of these, not thousands,
    // so this is cheap — unlike reading every span.
    var visibleLimit = window.innerHeight + 400;
    var now = [];
    var later = [];

    for (var i = 0; i < blocks.length; i++) {
      var rect = blocks[i].block.getBoundingClientRect();
      var onScreen = rect.bottom > -200 && rect.top < visibleLimit;
      if (onScreen && now.length < BATCH_BLOCKS * 2) now.push(blocks[i]);
      else later.push(blocks[i]);
    }

    if (now.length) treatBlocks(now);
    if (later.length) watchBlocks(later);
    report();
  }

  /* Hand every block to the IntersectionObserver. Work starts when a block is
   * within LOOKAHEAD of the viewport and not before, so a long article costs
   * only what the reader actually looks at. */
  function watchBlocks(blocks) {
    if (state.degraded) return;
    if (!state.intersection) {
      state.intersection = new IntersectionObserver(onNear, { rootMargin: LOOKAHEAD });
    }
    for (var i = 0; i < blocks.length; i++) {
      state.intersection.observe(blocks[i].block);
    }
  }

  function onNear(observed) {
    // Nearest to the middle of the viewport first, so the reader's own screen
    // is finished before anything else is started.
    var middle = window.innerHeight / 2;
    var arriving = [];
    for (var i = 0; i < observed.length; i++) {
      if (!observed[i].isIntersecting) continue;
      var entry = state.entries.get(observed[i].target);
      if (!entry || state.treated.has(entry.block)) continue;
      var rect = observed[i].boundingClientRect;
      arriving.push({ entry: entry, distance: Math.abs(rect.top - middle) });
      state.intersection.unobserve(observed[i].target);
    }
    if (!arriving.length) return;

    arriving.sort(function (a, b) { return a.distance - b.distance; });
    for (var j = 0; j < arriving.length; j++) state.queue.push(arriving[j].entry);
    scheduleWork();
  }

  /* =========================================================================
   * THE WORK LOOP
   * ========================================================================= */

  function whenIdle(callback) {
    if (typeof window.requestIdleCallback === 'function') {
      // 100ms, not 250. This only ever runs for text below the fold, but a
      // reader who scrolls fast can outrun it, and arriving at plain text that
      // colours in a moment later is the thing that reads as slow.
      return window.requestIdleCallback(callback, { timeout: 100 });
    }
    // No requestIdleCallback. A short timeout at least lets the browser get a
    // frame out between batches.
    return window.setTimeout(function () {
      callback({ timeRemaining: function () { return SLICE_MS; } });
    }, 16);
  }

  function scheduleWork() {
    if (state.idle !== null || !state.on) return;
    state.idle = whenIdle(function (deadline) {
      state.idle = null;
      if (!state.on) return;
      runOneBatch(deadline);
      if (state.queue.length) scheduleWork();
    });
  }

  function runOneBatch(deadline) {
    var batch = [];
    var estimate = 0;

    while (state.queue.length) {
      var entry = state.queue[0];

      if (state.spanCount + estimate > state.settings.nodeBudget) {
        // Out of budget. Stop wrapping and leave the rest of the page as it
        // is: untouched text is a worse gradient but a working page, and the
        // legibility settings still apply to all of it.
        state.degraded = true;
        state.queue.length = 0;
        break;
      }

      state.queue.shift();
      batch.push(entry);
      estimate += Math.ceil(entry.characters / state.chunkSize);

      if (batch.length >= BATCH_BLOCKS || estimate >= BATCH_SPANS) break;
      if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 2) break;
    }

    if (batch.length) treatBlocks(batch);
    if (!state.queue.length) report();
  }

  /* One batch: wrap everything, then measure everything, then colour
   * everything. The three loops are the point — see the note at the top of
   * engine.js about reads and writes. */
  function treatBlocks(batch) {
    state.writing = true;

    /* --- wrap (writes) --- */
    var fresh = [];
    var i, j;
    for (i = 0; i < batch.length; i++) {
      var entry = batch[i];
      if (!entry.block.isConnected) continue;

      var spans = [];
      for (j = 0; j < entry.nodes.length; j++) {
        var node = entry.nodes[j];
        // The page may have replaced this text since it was collected.
        if (!node.parentNode || !node.isConnected) continue;
        var made = engine.wrapTextNode(node, state.chunkSize);
        for (var k = 0; k < made.length; k++) spans.push(made[k]);
      }
      if (!spans.length) continue;

      var unit = {
        block: entry.block,
        spans: spans,
        boxes: null,
        lines: null,
        // How long the text was when we wrapped it. Wrapping does not change
        // the text, so a different length later means the site rewrote this
        // paragraph and it needs doing again. Reading textContent does not
        // force layout, so this is safe to do in the write phase.
        characters: entry.block.textContent.length
      };
      state.units.push(unit);
      state.treated.add(entry.block);
      state.spanCount += spans.length;
      fresh.push(unit);
    }

    /* --- measure (reads only) --- */
    for (i = 0; i < fresh.length; i++) {
      fresh[i].boxes = engine.readBoxes(fresh[i].spans);
    }

    /* --- colour (writes only) --- */
    for (i = 0; i < fresh.length; i++) {
      fresh[i].lines = engine.groupLines(fresh[i].boxes);
      paintUnit(fresh[i]);
    }

    // Throw away the mutation records our own wrapping just generated, so the
    // observer does not immediately ask us to rescan our own work.
    if (state.observer) state.observer.takeRecords();
    state.writing = false;

    if (!state.firstPaintMs && state.startedAt) {
      state.firstPaintMs = performance.now() - state.startedAt;
    }
  }

  function paintUnit(unit) {
    if (!unit.boxes || !unit.lines) return;
    var colours = engine.computeColours(unit.boxes, unit.lines, {
      ramp: state.ramp,
      strength: state.settings.strength / 100,
      ink: state.ink
    });
    engine.applyColours(unit.spans, colours);
  }

  /* =========================================================================
   * REFLOW AND REPAINT
   *
   * Two different jobs, and keeping them apart is what makes the extension
   * feel quick:
   *
   *   repaint   the palette, strength or cycle changed. Line breaks are
   *             untouched, so the stored measurements are still true and this
   *             is pure writes. Instant, even on a long page.
   *
   *   remeasure the window resized, the zoom changed, the font changed. Lines
   *             broke somewhere else, so positions have to be read again — but
   *             the spans themselves are still correct, so nothing is
   *             re-wrapped. Wrapping is the expensive half and it never needs
   *             doing twice.
   * ========================================================================= */

  function repaintAll() {
    if (!state.on) return;
    buildRamp();
    state.writing = true;
    for (var i = 0; i < state.units.length; i++) paintUnit(state.units[i]);
    if (state.observer) state.observer.takeRecords();
    state.writing = false;
  }

  function remeasureAll() {
    if (!state.on) return;
    state.writing = true;

    var live = [];
    var i;
    for (i = 0; i < state.units.length; i++) {
      if (state.units[i].block.isConnected) live.push(state.units[i]);
    }
    state.units = live;

    for (i = 0; i < live.length; i++) {
      live[i].boxes = engine.readBoxes(live[i].spans);
    }
    for (i = 0; i < live.length; i++) {
      live[i].lines = engine.groupLines(live[i].boxes);
      paintUnit(live[i]);
    }

    if (state.observer) state.observer.takeRecords();
    state.writing = false;
  }

  /* =========================================================================
   * OBSERVERS
   * ========================================================================= */

  function startObservers() {
    /* New content: infinite scroll, a comment section loading, a single-page
     * app swapping the article out.
     *
     * The records are kept rather than thrown away, and that is the whole
     * point. The first version noted only "something changed" and then walked
     * the entire article looking for what — every text node, every element,
     * on every burst of mutations. On a page that mutates steadily, which is
     * most modern pages, that is a treadmill running the whole time the
     * extension is on. Remembering which subtrees actually changed turns a
     * full-article walk into a walk of the two paragraphs that arrived. */
    state.observer = new MutationObserver(function (records) {
      if (state.writing || !state.on) return;

      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) state.dirty.push(added[j]);
        }
        // The target matters too, and not for new content: when a framework
        // re-renders over a paragraph it removes our spans, and the target is
        // the only handle on which paragraph that was.
        if (records[i].removedNodes.length && records[i].target.nodeType === 1) {
          state.dirty.push(records[i].target);
        }
      }

      if (!state.dirty.length) return;
      clearTimeout(state.timers.rescan);
      state.timers.rescan = setTimeout(rescan, 400);
    });
    state.observer.observe(state.root, { childList: true, subtree: true });

    /* Anything that moves the line breaks. A ResizeObserver on the column
     * catches more than a window resize does: a sidebar folding away, a banner
     * appearing, the reader changing the width setting.
     *
     * It also fires once immediately on observe, by specification, and that
     * first callback is worthless here — it arrives moments after the initial
     * paint and would re-measure every span for nothing. */
    state.sawFirstResize = false;
    state.resize = new ResizeObserver(function () {
      if (!state.sawFirstResize) { state.sawFirstResize = true; return; }
      if (state.writing || !state.on) return;
      clearTimeout(state.timers.reflow);
      state.timers.reflow = setTimeout(remeasureAll, 120);
    });
    state.resize.observe(state.root);

    window.addEventListener('resize', onWindowResize, { passive: true });
    chrome.storage.onChanged.addListener(onStorageChanged);
  }

  function stopObservers() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (state.resize) { state.resize.disconnect(); state.resize = null; }
    if (state.intersection) { state.intersection.disconnect(); state.intersection = null; }
    window.removeEventListener('resize', onWindowResize);
    clearTimeout(state.timers.rescan);
    clearTimeout(state.timers.reflow);
  }

  function onWindowResize() {
    if (!state.on) return;
    clearTimeout(state.timers.reflow);
    state.timers.reflow = setTimeout(remeasureAll, 120);
  }

  /* Deal with whatever changed, and only with whatever changed. */
  function rescan() {
    var dirty = state.dirty;
    state.dirty = [];

    if (!state.on || !state.root.isConnected) return;

    var collected = [];
    var i;

    for (i = 0; i < dirty.length; i++) {
      var node = dirty[i];
      if (!node.isConnected || !state.root.contains(node)) continue;

      var painted = nearestTreated(node);
      if (painted) {
        /* Inside a paragraph we have already painted. Either the site changed
         * something harmless, or it re-rendered over our work.
         *
         * This branch is why a framework re-render is survivable. Without it
         * the block stays marked as done, is never looked at again, and that
         * paragraph loses its gradient permanently on the first re-render.
         *
         * Two things say the work is gone: the spans have vanished, or the
         * text is a different length from the text we wrapped. The second
         * catches a partial re-render that inserted new words between spans
         * that are still there. Comparing lengths is safe because wrapping
         * preserves the text exactly — if the length moved, the site moved
         * it. */
        var unit = unitFor(painted);
        var spansGone = !painted.querySelector('span.' + engine.CHUNK_CLASS);
        var textChanged = unit && painted.textContent.length !== unit.characters;

        if (spansGone || textChanged) {
          forget(painted);
          collected = collected.concat(collectIn(painted));
        }
        continue;
      }

      collected = collected.concat(collectIn(blockRootFor(node)));
    }

    var fresh = register(collected);
    if (fresh.length) startWork(fresh);
  }

  /* The nearest ancestor — itself included — that we have already painted. */
  function nearestTreated(node) {
    var current = node;
    while (current && current.nodeType === 1) {
      if (state.treated.has(current)) return current;
      if (current === state.root) return null;
      current = current.parentNode;
    }
    return null;
  }

  /* Widen an arbitrary changed node out to the block it sits in, so a site
   * inserting a bare <span> of new text does not get that span treated as a
   * paragraph of its own — which would restart the colour cycle in the middle
   * of a sentence. */
  function blockRootFor(node) {
    var current = node;
    while (current && current.nodeType === 1 && current !== state.root) {
      if (detect.BLOCK_TAGS[current.tagName]) return current;
      current = current.parentNode;
    }
    return node;
  }

  function unitFor(block) {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].block === block) return state.units[i];
    }
    return null;
  }

  /* Drop everything we know about a block, so it can be treated again. */
  function forget(block) {
    state.treated.delete(block);
    state.entries.delete(block);

    var kept = [];
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].block === block) {
        state.spanCount -= state.units[i].spans.length;
      } else {
        kept.push(state.units[i]);
      }
    }
    state.units = kept;
  }

  /* Blocks inside one subtree, including any open shadow roots in it. A custom
   * element that has just arrived brings its own shadow root, and a shadow root
   * cannot see the injected stylesheet, so each new one needs the reset again;
   * injectShadowReset ignores the ones that already have it. */
  function collectIn(root) {
    var found = detect.collectBlocks(root);

    var shadows = openShadowRootsIn(root);
    for (var i = 0; i < shadows.length; i++) {
      injectShadowReset(shadows[i]);
      if (state.shadowRoots.indexOf(shadows[i]) < 0) state.shadowRoots.push(shadows[i]);
      var inner = detect.collectBlocks(shadows[i]);
      for (var j = 0; j < inner.length; j++) found.push(inner[j]);
    }

    return found;
  }

  /* =========================================================================
   * COLOURS OF THE PAGE ITSELF
   * ========================================================================= */

  /* Read the ink and paper the page is actually using. Both matter: the ink is
   * what a low strength setting blends towards, and the paper is what the
   * contrast floor is measured against.
   *
   * Backgrounds are usually transparent all the way up to <body>, so this walks
   * up until it finds a real one. */
  function readPageColours() {
    var chosen = settingsApi.PAPERS[state.settings.paper];
    if (chosen) {
      state.paper = engine.parseColour(chosen.paper) || [255, 255, 255];
      state.ink = engine.parseColour(chosen.ink) || [27, 27, 26];
      return;
    }

    var computed = getComputedStyle(state.root);
    state.ink = engine.parseColour(computed.color) || [27, 27, 26];

    var node = state.root;
    var found = null;
    while (node && node.nodeType === 1) {
      found = engine.parseColour(getComputedStyle(node).backgroundColor);
      if (found) break;
      node = node.parentNode;
    }
    state.paper = found || [255, 255, 255];
  }

  /* Pick the palette to paint with.
   *
   * A dark page gets the dark-paper palette, whatever the reader chose, and
   * there is no setting for that. Painting a daytime palette onto a dark page
   * means dark text on a dark background — not a subtle effect but an
   * unreadable one — and the alternative of lightening the chosen palette to
   * fit was measured and collapses. palettes.js has the numbers. */
  function buildRamp() {
    var name = engine.isDark(state.paper)
      ? NS.palettes.DARK_PALETTE
      : state.settings.palette;

    state.ramp = engine.buildRamp(name, state.ink, state.paper, state.settings.cycle);
  }

  /* =========================================================================
   * THE STYLE ELEMENT
   *
   * Everything that depends on a setting is written here, into one <style> the
   * extension owns, so a slider can rewrite it without touching anything else.
   * Rules are only emitted for settings that are not "leave it alone", because
   * the fewer of somebody else's declarations we override, the fewer ways there
   * are to break their page.
   * ========================================================================= */

  function writeStyle() {
    if (!state.style) {
      state.style = document.createElement('style');
      state.style.id = 'gradient-reader-style';
      (document.head || document.documentElement).appendChild(state.style);
    }

    var s = state.settings;
    var css = [];
    var onBody = state.root === document.body;

    if (s.face === 'atkinson' || s.face === 'opendyslexic') {
      css.push(fontFaceRule(s.face));
    }

    /* C4 — links stop being blue when we paint them, so they need their other
     * signal back. Without this, a paragraph of links is indistinguishable
     * from a paragraph of text, and the gradient has quietly removed a piece
     * of the page's information. */
    if (s.linkUnderline) {
      css.push('.gr-article a {' +
               ' text-decoration-line: underline !important;' +
               ' text-underline-offset: 0.16em !important; }');
    }

    // Column width. Never on <body>: giving the whole document a max-width
    // moves furniture that has nothing to do with reading.
    if (s.measure > 0 && !onBody) {
      css.push('.gr-article {' +
               ' max-width: ' + s.measure + 'ch !important;' +
               ' margin-left: auto !important; margin-right: auto !important; }');
    }

    if (s.leading > 0) {
      css.push('.gr-article, .gr-article p, .gr-article li, .gr-article blockquote,' +
               ' .gr-article dd { line-height: ' + (s.leading / 100) + ' !important; }');
    }

    if (s.paraGap > 0) {
      css.push('.gr-article p, .gr-article blockquote {' +
               ' margin-bottom: ' + (s.paraGap / 100) + 'em !important; }');
    }

    // A percentage of whatever the site already chose, rather than a number of
    // pixels. Sites set body text anywhere from 14px to 21px, so an absolute
    // size would be a different change on every one of them.
    if (s.size > 0 && s.size !== 100) {
      css.push('.gr-article { font-size: ' + s.size + '% !important; }');
    }

    var paper = settingsApi.PAPERS[s.paper];
    if (paper) {
      css.push('html.gr-paper, html.gr-paper body {' +
               ' background-color: ' + paper.paper + ' !important;' +
               ' color: ' + paper.ink + ' !important; }');
      css.push('html.gr-paper .gr-article {' +
               ' background-color: ' + paper.paper + ' !important;' +
               ' background-image: none !important; }');
      document.documentElement.classList.add('gr-paper');
    } else {
      document.documentElement.classList.remove('gr-paper');
    }

    var family = settingsApi.FACES[s.face];
    if (family) {
      // font-family only. Setting the whole `font` shorthand would flatten the
      // page's own bold and italics, which must survive.
      css.push('.gr-article,' +
               ' .gr-article :not(pre):not(code):not(kbd):not(samp):not(var)' +
               ' { font-family: ' + family + ' !important; }');
    }

    state.style.textContent = css.join('\n');
  }

  /* The bundled faces, if they are actually there.
   *
   * local() comes first, so a reader who already has Atkinson Hyperlegible or
   * OpenDyslexic installed uses their copy and nothing loads at all. The url()
   * is a file inside the extension — see fonts/README.md. If the file has not
   * been added, this rule simply fails and the fallbacks in settings.js take
   * over. Nothing is ever fetched from the network; there is no host to fetch
   * it from and no permission to do it with. */
  function fontFaceRule(face) {
    if (face === 'atkinson') {
      return '@font-face { font-family: "GR Atkinson"; font-display: swap;' +
             ' src: local("Atkinson Hyperlegible"),' +
             ' url("' + chrome.runtime.getURL('fonts/AtkinsonHyperlegible-Regular.woff2') +
             '") format("woff2"); }';
    }
    return '@font-face { font-family: "GR OpenDyslexic"; font-display: swap;' +
           ' src: local("OpenDyslexic"), local("OpenDyslexic Regular"),' +
           ' url("' + chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2') +
           '") format("woff2"); }';
  }

  /* =========================================================================
   * SHADOW DOM
   *
   * An open shadow root is a separate little document: a TreeWalker will not
   * step into one, and the stylesheet injected into the page does not reach
   * inside it either. Both have to be done again per root. Closed shadow roots
   * are, by design, not reachable at all, and text inside one stays untreated.
   * ========================================================================= */

  function openShadowRootsIn(root) {
    var found = [];
    var pending = [root];

    while (pending.length) {
      var current = pending.pop();
      var walker = document.createTreeWalker(current, NodeFilter.SHOW_ELEMENT);
      var element = walker.nextNode();
      while (element) {
        if (element.shadowRoot) {
          found.push(element.shadowRoot);
          pending.push(element.shadowRoot);
        }
        element = walker.nextNode();
      }
    }
    return found;
  }

  /* The three declarations from content.css that actually matter, repeated
   * because a shadow root cannot see the injected stylesheet. content.css is
   * the canonical version and explains why each one is here; if that file
   * changes, this needs looking at too. */
  var SHADOW_RESET = 'span.gr-c { display: inline !important; font: inherit !important;' +
                     ' -webkit-text-fill-color: currentColor !important; }';

  function injectShadowReset(shadowRoot) {
    if (shadowRoot.querySelector('style[data-gradient-reader]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-gradient-reader', '');
    style.textContent = SHADOW_RESET;
    shadowRoot.appendChild(style);
  }

  /* =========================================================================
   * TURNING OFF
   *
   * Put the page back. Because wrapping preserved the text exactly, unwrapping
   * really does restore the original DOM rather than something that looks like
   * it: every span becomes its text again and normalize() joins the pieces.
   * ========================================================================= */

  function turnOff() {
    if (!state.on) return;
    state.on = false;
    stopObservers();
    chrome.storage.onChanged.removeListener(onStorageChanged);

    if (state.idle !== null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(state.idle);
      } else {
        clearTimeout(state.idle);
      }
      state.idle = null;
    }

    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].block.isConnected) engine.unwrap(state.units[i].block);
    }

    for (var j = 0; j < state.shadowRoots.length; j++) {
      var leftover = state.shadowRoots[j].querySelector('style[data-gradient-reader]');
      if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    }

    if (state.style && state.style.parentNode) {
      state.style.parentNode.removeChild(state.style);
    }
    state.style = null;

    if (state.root) state.root.classList.remove('gr-article');
    document.documentElement.classList.remove('gr-on', 'gr-paper');

    state.root = null;
    state.units = [];
    state.queue = [];
    state.dirty = [];
    state.shadowRoots = [];
    state.treated = null;
    state.entries = null;
    state.spanCount = 0;
    state.degraded = false;
    announce();
  }

  /* =========================================================================
   * SETTINGS CHANGES
   * ========================================================================= */

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (!changes.settings && !changes.sites) return;
    loadSettings().then(function (changed) {
      if (!state.on) return;
      if (changed.needsStyle) {
        writeStyle();
        readPageColours();
        // A font or a width change moves the line breaks, so positions have to
        // be read again. Wait a frame for the new styles to take effect first.
        requestAnimationFrame(function () {
          requestAnimationFrame(remeasureAll);
        });
      } else {
        repaintAll();
      }
    });
  }

  /* Which settings need what. Anything that can move a line break needs a
   * re-measure; the rest only need repainting, which is instant. */
  var LAYOUT_KEYS = ['measure', 'leading', 'paraGap', 'size', 'face', 'paper',
                     'linkUnderline'];

  function loadSettings() {
    return settingsApi.load().then(function (stored) {
      var next = settingsApi.forHost(stored.settings, stored.sites, state.host);
      var previous = state.settings;
      var needsStyle = false;

      for (var i = 0; i < LAYOUT_KEYS.length; i++) {
        if (previous[LAYOUT_KEYS[i]] !== next[LAYOUT_KEYS[i]]) needsStyle = true;
      }

      state.settings = next;
      state.mode = settingsApi.modeForHost(stored.sites, state.host);
      return { needsStyle: needsStyle, mode: state.mode };
    });
  }

  /* =========================================================================
   * TALKING TO THE REST OF THE EXTENSION
   * ========================================================================= */

  /* Does this page look like an article? Worked out once and remembered.
   *
   * This used to run on demand, inside status(), which meant that opening the
   * popup fired a full detection pass — every candidate container measured for
   * prose and link density, which on a big page means reading textContent over
   * most of the document — while the popup sat there waiting for the answer.
   * That was half of why opening the popup felt slow.
   *
   * It is worked out once shortly after load instead, when nothing is waiting
   * for it, and the answer is a coarse hint that does not need to be fresh. */
  function articleHint() {
    if (state.articleHint === null) {
      state.articleHint = !!detect.findArticleRoot(
        document, ASKED_MIN_CHARACTERS, ASKED_MIN_PARAGRAPHS
      );
    }
    return state.articleHint;
  }

  function status() {
    return {
      ok: true,
      on: state.on,
      host: state.host,
      // `null` means "not worked out yet", and the popup says nothing rather
      // than guessing out loud.
      hasArticle: state.on ? true : state.articleHint,
      autoAllowed: detect.autoRunAllowed(state.host),
      spans: state.spanCount,
      blocks: state.units.length,
      degraded: state.degraded,
      firstPaintMs: Math.round(state.firstPaintMs)
    };
  }

  function announce() {
    // Only the top frame owns the toolbar badge.
    if (window.top !== window) return;
    try {
      chrome.runtime.sendMessage({ type: 'page-state', on: state.on });
    } catch (e) {
      // The service worker may be asleep or the extension reloading. The badge
      // being briefly wrong is not worth handling.
    }
  }

  /* One line in the console, once, describing the first paint. This is the only
   * place the extension says anything, and it says it where a reader will never
   * see it. Enough to answer "why did nothing happen" and "why was that slow"
   * without ever putting a notice on the page.
   *
   * The counts are what was painted at first paint — the screenful the reader
   * is looking at — not the whole article, because the rest is deliberately not
   * done yet. That is also what makes the millisecond figure meaningful: it
   * should be roughly the same on a 500 word page and a 5,000 word one, and if
   * it scales with the length of the article then something is processing
   * everything up front. */
  function report() {
    if (state.reported || !state.on || !state.units.length) return;
    state.reported = true;

    var lines = 0;
    for (var i = 0; i < state.units.length; i++) {
      lines += state.units[i].lines ? state.units[i].lines.length : 0;
    }

    console.log(
      '%cGradient Reader%c first paint ' + Math.round(state.firstPaintMs) +
      'ms — ' + state.units.length + ' blocks, ' + lines + ' visual lines, ' +
      state.spanCount + ' spans of ' + state.chunkSize + ' characters. ' +
      'The rest of the page is wrapped as you scroll to it.' +
      (state.degraded
        ? ' Node budget reached — the far end of the page will be left plain.'
        : ''),
      'font-weight:600', 'font-weight:400'
    );
  }

  chrome.runtime.onMessage.addListener(function (message, sender, respond) {
    if (!message || !message.type) return;

    if (message.type === 'ping') {
      respond(status());
      return;
    }

    if (message.type === 'status') {
      respond(status());
      return;
    }

    if (message.type === 'toggle') {
      loadSettings().then(function () {
        if (state.on) turnOff(); else turnOn(true);
        respond(status());
      });
      return true;
    }

    if (message.type === 'on') {
      loadSettings().then(function () {
        turnOn(true);
        respond(status());
      });
      return true;
    }

    if (message.type === 'off') {
      turnOff();
      respond(status());
      return;
    }
  });

  /* =========================================================================
   * BOOT
   *
   * There are two ways this file starts running.
   *
   * Registered on a domain the reader enabled: it should turn itself on, if
   * the page really is an article and is not one of the applications on the
   * never-fire list.
   *
   * Injected because somebody just pressed the button or the shortcut: it
   * should do nothing here and wait. background.js sends an explicit "on"
   * straight after injecting, and turnOn does nothing when it is already on,
   * so the two paths cannot fight each other.
   * ========================================================================= */

  loadSettings().then(function (loaded) {
    if (state.settings.autoRun && loaded.mode === 'on') {
      turnOn(false);
      return;
    }

    /* Not running here. Work out whether this even looks like an article, so
     * that opening the popup gets an instant answer instead of waiting for the
     * detection pass. Done at idle, because nothing is waiting for it now and
     * the page has better things to do. */
    if (window.top !== window) return;
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(articleHint, { timeout: 3000 });
    } else {
      window.setTimeout(articleHint, 800);
    }
  });
})();
