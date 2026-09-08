/* Gradient Reader — what to treat, and what to leave completely alone.
 *
 * Two jobs:
 *
 *   1. Decide whether this page is an article at all. Firing on Gmail, a Jira
 *      board or a spreadsheet is worse than doing nothing, because the reader
 *      then has to work out what just happened to their inbox.
 *
 *   2. Collect the blocks of prose to treat, and refuse the ones where
 *      rewriting the text nodes would break something. Breaking a page is
 *      worse than not helping.
 *
 * The rules here are explicit lists, not scores. When a page is ambiguous the
 * answer is to do nothing, and a list makes it obvious why nothing happened.
 */

(function () {
  'use strict';

  /* -----------------------------------------------------------------------
   * NEVER TOUCH
   *
   * Wrapping the text inside any of these either breaks how it works or
   * breaks how it reads. Each one is here for a reason:
   *
   *   input, textarea, select, option, button   the text is a value, or a
   *                                             control's label
   *   pre, code, kbd, samp, var, tt             whitespace and alignment
   *                                             carry meaning
   *   math, svg                                 not text in the way we mean
   *   nav, header, footer, aside, form          not prose, and the place
   *                                             site layouts are most fragile
   *   table                                     alignment again
   *   h1                                        the headline is one line; a
   *                                             gradient across it is just
   *                                             decoration, and decoration is
   *                                             what makes this look like a toy
   *   script, style, noscript, template         not visible text
   *   video, audio, canvas, iframe, object      no text of ours in there
   * --------------------------------------------------------------------- */
  var SKIP_TAGS = {
    INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, OPTGROUP: 1, BUTTON: 1,
    LABEL: 1, LEGEND: 1, FIELDSET: 1, FORM: 1,
    PRE: 1, CODE: 1, KBD: 1, SAMP: 1, VAR: 1, TT: 1,
    MATH: 1, SVG: 1,
    NAV: 1, HEADER: 1, FOOTER: 1, ASIDE: 1, MENU: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TD: 1, TH: 1,
    H1: 1,
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TITLE: 1,
    VIDEO: 1, AUDIO: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1,
    SELECTEDCONTENT: 1
  };

  /* Roles that say "this is interface, not prose", whatever tag was used. */
  var SKIP_ROLES = {
    navigation: 1, banner: 1, contentinfo: 1, search: 1, form: 1,
    toolbar: 1, menu: 1, menubar: 1, menuitem: 1, tablist: 1, tab: 1,
    button: 1, textbox: 1, searchbox: 1, combobox: 1, listbox: 1,
    dialog: 1, alertdialog: 1, alert: 1, status: 1, log: 1, timer: 1,
    presentation: 1, none: 1
  };

  /* -----------------------------------------------------------------------
   * NEVER FIRE BY ITSELF
   *
   * Applications that happen to be made of text. Even where the extension
   * could technically wrap something here, the reader did not come to these
   * to read an article, and a mail client whose message list has turned
   * purple is a support ticket.
   *
   * A deliberate toolbar click still works everywhere — this list only stops
   * the automatic run. If you actually want a gradient on a Notion page you
   * can ask for one; you just will not get one by surprise.
   * --------------------------------------------------------------------- */
  var NEVER_AUTO = [
    'mail.google.com', 'inbox.google.com', 'docs.google.com', 'drive.google.com',
    'sheets.google.com', 'slides.google.com', 'calendar.google.com',
    'meet.google.com', 'chat.google.com', 'script.google.com',
    'outlook.office.com', 'outlook.live.com', 'teams.microsoft.com',
    'app.slack.com', 'discord.com', 'web.whatsapp.com', 'messages.google.com',
    'figma.com', 'www.figma.com', 'miro.com', 'app.asana.com',
    'trello.com', 'linear.app', 'notion.so', 'www.notion.so',
    'overleaf.com', 'www.overleaf.com', 'colab.research.google.com',
    'chatgpt.com', 'claude.ai', 'gemini.google.com'
  ];

  /* Hosts whose subdomains are all applications. */
  var NEVER_AUTO_SUFFIXES = [
    '.atlassian.net', '.salesforce.com', '.lightning.force.com',
    '.zendesk.com', '.freshdesk.com', '.servicenow.com', '.workday.com',
    '.sharepoint.com', '.slack.com', '.notion.site'
  ];

  /* Where an article usually is, best guess first. */
  var ARTICLE_SELECTORS = [
    'article',
    '[role="article"]',
    'main article',
    '[itemprop="articleBody"]',
    '.post-content', '.entry-content', '.article-body', '.article__body',
    '.post-body', '.story-body', '.markdown-body', '.prose',
    'main',
    '[role="main"]',
    '#content', '.content'
  ];

  /* Tags that count as one block of prose. A text node is attributed to its
   * nearest ancestor in this list. */
  var BLOCK_TAGS = {
    P: 1, LI: 1, BLOCKQUOTE: 1, DD: 1, DT: 1, FIGCAPTION: 1,
    H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, DETAILS: 1, SUMMARY: 1,
    BODY: 1
  };

  function autoRunAllowed(host) {
    if (!host) return false;
    for (var i = 0; i < NEVER_AUTO.length; i++) {
      if (host === NEVER_AUTO[i]) return false;
    }
    for (var j = 0; j < NEVER_AUTO_SUFFIXES.length; j++) {
      var suffix = NEVER_AUTO_SUFFIXES[j];
      if (host.length > suffix.length &&
          host.slice(-suffix.length) === suffix) {
        return false;
      }
    }
    return true;
  }

  /* True if this element, or anything it sits inside up to `stopAt`, is on the
   * never-touch list. */
  function isForbidden(element, stopAt) {
    var node = element;
    while (node && node.nodeType === 1) {
      if (SKIP_TAGS[node.tagName]) return true;

      if (node.isContentEditable) return true;
      if (node.getAttribute) {
        if (node.getAttribute('aria-hidden') === 'true') return true;
        if (node.hasAttribute('data-gr-skip')) return true;

        var role = node.getAttribute('role');
        if (role && SKIP_ROLES[role.toLowerCase()]) return true;
      }

      // Our own spans, from an earlier run.
      if (node.classList && node.classList.contains('gr-c')) return true;

      if (node === stopAt) return false;
      node = node.parentNode;
    }
    return false;
  }

  /* The nearest ancestor that counts as one block of prose. */
  function blockFor(node, stopAt) {
    var current = node.parentNode;
    while (current && current.nodeType === 1) {
      if (BLOCK_TAGS[current.tagName]) return current;
      if (current === stopAt) return current;
      current = current.parentNode;
    }
    return null;
  }

  /* Walk `root` and return the blocks worth treating, in document order.
   *
   * Each entry is { block: element, nodes: [text nodes], characters: number }.
   *
   * The walk groups text nodes by their block rather than taking whole
   * elements, because prose is full of inline markup — <em>, <strong>, <a> —
   * and the point is to leave every one of those elements exactly where it is
   * and only rewrite the text between them. That is what keeps the page's own
   * bold and italics intact. */
  function collectBlocks(root, minBlockCharacters) {
    var minimum = minBlockCharacters === undefined ? 24 : minBlockCharacters;
    var doc = root.ownerDocument || document;

    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        // Nothing but whitespace is not text worth colouring.
        if (!/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (isForbidden(node.parentNode, root)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var order = [];          // blocks, first seen first
    var byBlock = new Map(); // block element -> entry

    var node = walker.nextNode();
    while (node) {
      var block = blockFor(node, root);
      if (block) {
        var entry = byBlock.get(block);
        if (!entry) {
          entry = { block: block, nodes: [], characters: 0 };
          byBlock.set(block, entry);
          order.push(entry);
        }
        entry.nodes.push(node);
        entry.characters += node.nodeValue.length;
      }
      node = walker.nextNode();
    }

    // Drop the scraps. A three-word div is a byline or a tag, and colouring it
    // costs nodes without ever helping a return sweep — a block that never
    // wraps onto a second line has no return sweep to help.
    var kept = [];
    for (var i = 0; i < order.length; i++) {
      if (order[i].characters >= minimum) kept.push(order[i]);
    }
    return kept;
  }

  /* How much of an element's text is inside links. A high number means a list
   * of headlines or a navigation block rather than something to read. */
  function linkDensity(element) {
    var total = (element.textContent || '').replace(/\s+/g, ' ').length;
    if (!total) return 1;

    var links = element.querySelectorAll('a');
    var linked = 0;
    for (var i = 0; i < links.length; i++) {
      linked += (links[i].textContent || '').replace(/\s+/g, ' ').length;
    }
    return linked / total;
  }

  /* Score one candidate container. Prose length and paragraph count — real
   * counts of real characters, never a similarity measure.
   *
   * `enough` is an early exit. Nothing here needs to know that a container has
   * 40,000 characters of prose rather than 5,000; it needs to know the
   * container clears the bar and roughly how it compares to its rivals. Since
   * candidates nest, the same text gets measured several times over, and
   * without a cap that means reading textContent across most of the document
   * once per candidate. Where two containers both hit the cap the tie goes to
   * whichever was tried first, which is the tighter selector — the one we
   * wanted anyway. */
  function proseCharacters(element, enough) {
    var paragraphs = element.querySelectorAll('p, li, blockquote');
    var limit = enough || Infinity;
    var characters = 0;
    var counted = 0;

    for (var i = 0; i < paragraphs.length; i++) {
      var text = (paragraphs[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 60) {
        characters += text.length;
        counted++;
        if (characters >= limit) break;
      }
    }
    return { characters: characters, paragraphs: counted };
  }

  /* Find the element that holds the article, or null if this page does not look
   * like one.
   *
   *   minCharacters   how much real prose a page has to have. The caller passes
   *                   a high number for the automatic run and a low one for a
   *                   deliberate toolbar click, because someone who has just
   *                   clicked the button has already answered the question of
   *                   whether they want this here.
   */
  function findArticleRoot(doc, minCharacters, minParagraphs) {
    if (!doc.body) return null;

    var enough = minCharacters * 4;
    var seen = new Set();
    var qualifying = [];
    var i, j;

    /* Measure each candidate once. An element that matches three of the
     * selectors below used to be measured three times; `seen` is what stops
     * that. Link density is deliberately not measured here — it is the
     * expensive test and most candidates never need it. */
    for (i = 0; i < ARTICLE_SELECTORS.length; i++) {
      var candidates = doc.querySelectorAll(ARTICLE_SELECTORS[i]);
      for (j = 0; j < candidates.length; j++) {
        var element = candidates[j];
        if (!element.isConnected || seen.has(element)) continue;
        seen.add(element);

        var measured = proseCharacters(element, enough);
        if (measured.characters < minCharacters) continue;
        if (measured.paragraphs < minParagraphs) continue;
        qualifying.push({ element: element, score: measured.characters });
      }
    }

    // Some perfectly readable pages are a stylesheet and a stack of <p> with
    // no wrapper at all, so the body is a candidate of last resort.
    if (!seen.has(doc.body)) {
      var bodyProse = proseCharacters(doc.body, enough);
      if (bodyProse.characters >= minCharacters &&
          bodyProse.paragraphs >= minParagraphs) {
        qualifying.push({ element: doc.body, score: bodyProse.characters });
      }
    }

    /* Most prose wins. Array.prototype.sort is stable, so candidates that tied
     * at the cap stay in the order they were tried, which is tightest selector
     * first. Only now is link density measured, and only until one candidate
     * passes: a page of headlines scores well on prose and has to be caught,
     * but reading every link in every candidate to find that out is the one
     * genuinely expensive thing in this file. */
    qualifying.sort(function (a, b) { return b.score - a.score; });

    for (i = 0; i < qualifying.length; i++) {
      if (linkDensity(qualifying[i].element) <= 0.45) return qualifying[i].element;
    }

    return null;
  }

  var api = {
    SKIP_TAGS: SKIP_TAGS,
    BLOCK_TAGS: BLOCK_TAGS,
    NEVER_AUTO: NEVER_AUTO,
    NEVER_AUTO_SUFFIXES: NEVER_AUTO_SUFFIXES,
    autoRunAllowed: autoRunAllowed,
    isForbidden: isForbidden,
    collectBlocks: collectBlocks,
    findArticleRoot: findArticleRoot,
    linkDensity: linkDensity,
    proseCharacters: proseCharacters
  };

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GradientReader = root.GradientReader || {};
  root.GradientReader.detect = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
