// Rote — the filler.
//
// This file is injected into the page when the toolbar button is clicked. It reads
// the saved answers, looks at every field on the page, and fills only the ones it
// is sure about. Everything else is left exactly as it was.
//
// It reads ROTE_RULES, which rules.js defines. background.js injects rules.js
// first, so by the time this runs that variable exists.
//
// The whole file is wrapped in a function that runs immediately. That keeps its
// variables out of the page's way, and means clicking the toolbar button twice in a
// row doesn't collide with the first run.

(function () {
  "use strict";

  var STORAGE_KEY = "roteProfile";

  // The input types Rote is willing to type into. An empty string is in the list
  // because <input> with no type attribute behaves as type="text".
  var ALLOWED_INPUT_TYPES = ["text", "email", "tel", "url", "number", "search", ""];

  // Names for the things Rote adds to the page. Fixed ids mean a second click can
  // find and clean up after the first one.
  var HIGHLIGHT_CLASS = "rote-just-filled";
  var FADING_CLASS = "rote-just-filled-fading";
  var STYLE_ID = "rote-highlight-style";
  var TOAST_ID = "rote-toast";

  // How long a filled field stays lit up before fading out.
  var HIGHLIGHT_MS = 2000;
  var FADE_MS = 500;

  // --------------------------------------------------------------------------
  // Cleaning up text before comparing it
  // --------------------------------------------------------------------------
  //
  // There are two kinds of text to search, and each needs its own clean-up:
  //
  //   attributes    name="job_application[first_name]" — punctuation is noise, so
  //                 remove it entirely: "jobapplicationfirstname"
  //   visible text  "Current CTC (annual, INR)" — spaces separate real words, so
  //                 turn punctuation into spaces: "current ctc annual inr"
  //
  // Patterns from rules.js get cleaned with whichever function is being used on the
  // text, so one pattern list works for both.

  function normalizeAttribute(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function normalizeVisibleText(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // --------------------------------------------------------------------------
  // Finding which rules match a piece of text
  // --------------------------------------------------------------------------

  // Look for every rule whose match patterns appear in this text.
  //
  // Returns two lists:
  //   hitKeys      rules whose match patterns appeared at all
  //   allowedKeys  those of them that were not thrown out by an exclude pattern
  //
  // The difference matters. A rule that hit and was then excluded still counts as
  // evidence that this text is about compensation (or whatever), so the search
  // stops there rather than falling through to a weaker clue.
  function findRuleMatches(text, normalize) {
    var result = { hitKeys: [], allowedKeys: [] };

    if (!text) {
      return result;
    }

    var haystack = normalize(text);

    if (haystack === "") {
      return result;
    }

    for (var i = 0; i < ROTE_RULES.length; i++) {
      var rule = ROTE_RULES[i];

      if (!containsAnyPattern(haystack, rule.match, normalize)) {
        continue;
      }

      result.hitKeys.push(rule.key);

      if (!containsAnyPattern(haystack, rule.exclude, normalize)) {
        result.allowedKeys.push(rule.key);
      }
    }

    return result;
  }

  // True if any of these patterns appears inside the haystack.
  function containsAnyPattern(haystack, patterns, normalize) {
    for (var i = 0; i < patterns.length; i++) {
      var pattern = normalize(patterns[i]);

      // A pattern that cleans up to nothing would match everything, so ignore it.
      if (pattern === "") {
        continue;
      }

      if (haystack.indexOf(pattern) !== -1) {
        return true;
      }
    }

    return false;
  }

  // Look up a rule by the answer it is about.
  function findRuleByKey(key) {
    for (var i = 0; i < ROTE_RULES.length; i++) {
      if (ROTE_RULES[i].key === key) {
        return ROTE_RULES[i];
      }
    }

    return null;
  }

  // The first signal, handled separately because autocomplete tokens are a fixed
  // list of official values. "email" is matched as a whole token, never as a
  // fragment, and exclude patterns don't apply.
  function findAutocompleteMatches(field) {
    var result = { hitKeys: [], allowedKeys: [] };
    var raw = field.getAttribute("autocomplete");

    if (!raw) {
      return result;
    }

    var tokens = raw.toLowerCase().trim().split(/\s+/);

    for (var i = 0; i < ROTE_RULES.length; i++) {
      var rule = ROTE_RULES[i];

      for (var j = 0; j < rule.autocomplete.length; j++) {
        if (tokens.indexOf(rule.autocomplete[j]) !== -1) {
          result.hitKeys.push(rule.key);
          result.allowedKeys.push(rule.key);
          break;
        }
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Reading the label attached to a field
  // --------------------------------------------------------------------------

  // Two shapes cover both platforms:
  //
  //   Greenhouse   <label for="question_123">…</label> sits beside the input
  //   Lever        the input is nested INSIDE the <label>, with no for attribute
  //
  // Both are fragile: they depend on the platform's current markup. If Rote stops
  // recognising custom questions, this function is the first place to look.
  function findLabelText(field) {
    if (field.id) {
      var byFor = document.querySelector('label[for="' + CSS.escape(field.id) + '"]');
      if (byFor) {
        return readLabelWords(byFor);
      }
    }

    var wrappingLabel = field.closest("label");
    if (wrappingLabel) {
      return readLabelWords(wrappingLabel);
    }

    return "";
  }

  // Read a label's words, ignoring the contents of any form field inside it.
  //
  // This matters because Lever puts the field inside the label. Reading the label
  // plainly would fold every dropdown option into the question: the label for
  // "Are you willing to relocate?" came out as "Are you willing to relocate?
  // Select one... Yes No". Harmless there, but a dropdown with an option
  // mentioning, say, current pay could trip an exclude word and silently kill a
  // good match. Working on a copy of the label leaves the real page untouched.
  function readLabelWords(label) {
    var copy = label.cloneNode(true);
    var nestedFields = copy.querySelectorAll("input, textarea, select, option, button");

    for (var i = 0; i < nestedFields.length; i++) {
      nestedFields[i].remove();
    }

    return copy.textContent;
  }

  // --------------------------------------------------------------------------
  // Deciding what to do with one field
  // --------------------------------------------------------------------------

  // Returns either
  //   { action: "fill", key: "currentCtc", signal: "label" }
  // or
  //   { action: "skip", reason: "…" }
  function decideForField(field, profile) {
    var tagName = field.tagName.toLowerCase();

    // ---- Reasons to leave a field alone that have nothing to do with matching.

    if (tagName === "input" && ALLOWED_INPUT_TYPES.indexOf(field.type) === -1) {
      return { action: "skip", reason: "input type is " + field.type };
    }

    if (field.disabled) {
      return { action: "skip", reason: "disabled" };
    }

    if (field.readOnly) {
      return { action: "skip", reason: "read only" };
    }

    // offsetParent is null for anything that isn't being displayed. It is a rough
    // test, not a perfect one — see the note in CLAUDE.md.
    if (field.offsetParent === null) {
      return { action: "skip", reason: "not visible" };
    }

    if (field.value && field.value.trim() !== "") {
      return { action: "skip", reason: "already has a value" };
    }

    // ---- Now work through the signals, best first, and stop at the first one that
    // says anything at all about this field.

    var signals = [
      { name: "autocomplete", matches: findAutocompleteMatches(field) },
      { name: "name attribute", matches: findRuleMatches(field.getAttribute("name"), normalizeAttribute) },
      { name: "id attribute", matches: findRuleMatches(field.id, normalizeAttribute) },
      { name: "label", matches: findRuleMatches(findLabelText(field), normalizeVisibleText) },
      { name: "aria-label", matches: findRuleMatches(field.getAttribute("aria-label"), normalizeVisibleText) },
      { name: "placeholder", matches: findRuleMatches(field.getAttribute("placeholder"), normalizeVisibleText) },
    ];

    // Note that name and id are separate entries above but count as one step: if
    // the name says nothing, the id gets a turn before labels are considered.

    var winning = null;

    for (var i = 0; i < signals.length; i++) {
      if (signals[i].matches.hitKeys.length > 0) {
        winning = signals[i];
        break;
      }
    }

    if (winning === null) {
      return { action: "skip", reason: "no rule matched" };
    }

    var allowedKeys = winning.matches.allowedKeys;

    if (allowedKeys.length === 0) {
      return {
        action: "skip",
        reason:
          "matched " + winning.matches.hitKeys.join(" and ") + " on the " + winning.name +
          ", but an exclude word ruled it out",
      };
    }

    // More than one answer could go here, so none of them does. This is the guard
    // that stops "Current & Expected CTC" from receiving either number.
    if (allowedKeys.length > 1) {
      return {
        action: "skip",
        reason: "ambiguous — matched " + allowedKeys.join(" and ") + " on the " + winning.name,
      };
    }

    var matchedKey = allowedKeys[0];

    // A couple of questions are asked as prose in one form and as a Yes/No dropdown
    // in another. A rule can name a second answer for the dropdown case, so that a
    // sentence is never squeezed into a dropdown or vice versa.
    var key = matchedKey;

    if (tagName === "select") {
      var matchedRule = findRuleByKey(matchedKey);
      if (matchedRule && matchedRule.dropdownKey) {
        key = matchedRule.dropdownKey;
      }
    }

    var answer = profile[key];

    if (typeof answer !== "string" || answer.trim() === "") {
      return { action: "skip", reason: "matched " + key + ", but that answer is empty" };
    }

    // ---- Last checks: can this particular field actually hold this answer?

    if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(answer.trim())) {
      return {
        action: "skip",
        reason: 'matched ' + key + ', but this is a number field and "' + answer + '" is not a plain number',
      };
    }

    if (field.maxLength && field.maxLength > 0 && answer.length > field.maxLength) {
      return {
        action: "skip",
        reason: "matched " + key + ", but the answer is longer than the field allows",
      };
    }

    // For a dropdown, what gets set is not the answer itself but the value of the
    // option whose text reads like the answer. Greenhouse's "Yes" option, for
    // instance, carries value="1".
    if (tagName === "select") {
      var option = findMatchingOption(field, answer);

      if (option === null) {
        return {
          action: "skip",
          reason: 'matched ' + key + ', but no dropdown option reads exactly "' + answer + '"',
        };
      }

      return { action: "fill", key: key, signal: winning.name, option: option };
    }

    return { action: "fill", key: key, signal: winning.name, option: null };
  }

  // --------------------------------------------------------------------------
  // Dropdowns
  // --------------------------------------------------------------------------

  // Find the option whose visible text is the answer. Exact match only, after
  // clean-up: "Yes" matches "yes", but nothing matches "Yes, I am authorized",
  // because guessing which of several similar options was meant is exactly the kind
  // of cleverness this extension refuses to do.
  function findMatchingOption(select, answer) {
    var wanted = normalizeVisibleText(answer);

    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];

      if (normalizeVisibleText(option.textContent) === wanted) {
        return option;
      }

      if (option.value && normalizeVisibleText(option.value) === wanted) {
        return option;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Actually putting the value in
  // --------------------------------------------------------------------------

  // FRAGILITY WARNING. Greenhouse's newer boards are built with React, which keeps
  // its own copy of what each input contains. A plain `field.value = answer` can be
  // wiped out by React a moment later. Calling the browser's built-in value setter
  // and then firing an "input" event is what makes React notice the change. This
  // reaches into how React works rather than any documented API, so it is the most
  // likely thing here to break when Greenhouse updates.
  function setFieldValue(field, value) {
    var prototype;

    if (field instanceof HTMLTextAreaElement) {
      prototype = HTMLTextAreaElement.prototype;
    } else if (field instanceof HTMLSelectElement) {
      prototype = HTMLSelectElement.prototype;
    } else {
      prototype = HTMLInputElement.prototype;
    }

    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    // Both events, because form code in the wild listens for one or the other.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Choosing an option in a dropdown. Usually this is the same job as above, using
  // the option's value. The exception is an option with an empty value attribute,
  // where setting the value would select the wrong thing — there, the option's
  // position is used instead.
  function selectOption(select, option) {
    if (option.value !== "") {
      setFieldValue(select, option.value);
      return;
    }

    select.selectedIndex = option.index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // --------------------------------------------------------------------------
  // The brief highlight on filled fields
  // --------------------------------------------------------------------------

  // Put Rote's own stylesheet on the page, once. Adding it again on a later click
  // would be harmless but pointless, so it checks first.
  //
  // Every rule uses !important because these are competing with the job board's own
  // stylesheet, which is far more specific than anything written here.
  function addHighlightStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "." + HIGHLIGHT_CLASS + " {" +
      "  box-shadow: 0 0 0 3px rgba(31, 111, 67, 0.55) !important;" +
      "  background-color: #eaf6ef !important;" +
      "  transition: box-shadow " + FADE_MS + "ms ease, background-color " + FADE_MS + "ms ease !important;" +
      "}" +
      "." + FADING_CLASS + " {" +
      "  box-shadow: 0 0 0 0 rgba(31, 111, 67, 0) !important;" +
      "  background-color: transparent !important;" +
      "}";

    document.head.appendChild(style);
  }

  // Light the filled fields up, then fade them out and take the classes off again so
  // the page is left exactly as it was found.
  function highlightFields(filled) {
    addHighlightStyle();

    for (var i = 0; i < filled.length; i++) {
      filled[i].element.classList.add(HIGHLIGHT_CLASS);
    }

    setTimeout(function () {
      for (var j = 0; j < filled.length; j++) {
        filled[j].element.classList.add(FADING_CLASS);
      }

      setTimeout(function () {
        removeHighlights(filled);
      }, FADE_MS);
    }, HIGHLIGHT_MS);
  }

  function removeHighlights(filled) {
    for (var i = 0; i < filled.length; i++) {
      filled[i].element.classList.remove(HIGHLIGHT_CLASS);
      filled[i].element.classList.remove(FADING_CLASS);
    }
  }

  // --------------------------------------------------------------------------
  // The little box in the corner, with the undo button
  // --------------------------------------------------------------------------

  // Styles are set property by property in JavaScript rather than through a
  // stylesheet. Inline styles like these beat almost anything the job board's own
  // CSS might say about a div, which keeps the box readable on any page.
  function applyStyles(element, styles) {
    for (var property in styles) {
      element.style[property] = styles[property];
    }
  }

  // Show the box. `filled` is the list of fields that were just filled; when it is
  // empty there is nothing to undo, so no undo button is offered.
  function showToast(message, filled) {
    removeToast();

    var toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.setAttribute("role", "status");
    applyStyles(toast, {
      position: "fixed",
      bottom: "18px",
      right: "18px",
      // The largest value a z-index can hold, so nothing on the page covers it.
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      maxWidth: "380px",
      padding: "12px 14px",
      background: "#1f2328",
      color: "#ffffff",
      font: "14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      borderRadius: "8px",
      boxShadow: "0 6px 24px rgba(0, 0, 0, 0.35)",
      textAlign: "left",
    });

    var text = document.createElement("span");
    text.textContent = message;
    applyStyles(text, { flex: "1 1 auto" });
    toast.appendChild(text);

    if (filled.length > 0) {
      var undoButton = document.createElement("button");
      undoButton.type = "button";
      undoButton.textContent = "Undo";
      applyStyles(undoButton, {
        flex: "0 0 auto",
        padding: "6px 12px",
        font: "inherit",
        fontWeight: "600",
        color: "#1f2328",
        background: "#ffffff",
        border: "0",
        borderRadius: "5px",
        cursor: "pointer",
      });

      undoButton.addEventListener("click", function () {
        undoFill(filled);
        // Replace the box with a confirmation that has nothing left to undo.
        showToast("Rote put " + filled.length + " field(s) back.", []);
      });

      toast.appendChild(undoButton);
    }

    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "✕";
    closeButton.setAttribute("aria-label", "Dismiss");
    applyStyles(closeButton, {
      flex: "0 0 auto",
      padding: "4px 6px",
      font: "inherit",
      color: "#c9ced4",
      background: "transparent",
      border: "0",
      cursor: "pointer",
    });
    closeButton.addEventListener("click", removeToast);
    toast.appendChild(closeButton);

    document.body.appendChild(toast);
  }

  function removeToast() {
    var existing = document.getElementById(TOAST_ID);

    if (existing) {
      existing.remove();
    }
  }

  // Put every filled field back to whatever it held before. The same native value
  // setter is used as for filling, so React-rendered forms notice the change going
  // back as well as going in.
  function undoFill(filled) {
    for (var i = 0; i < filled.length; i++) {
      setFieldValue(filled[i].element, filled[i].previousValue);
    }

    removeHighlights(filled);
    console.log("Rote: undid " + filled.length + " field(s).");
  }

  // --------------------------------------------------------------------------
  // A readable name for a field, for the console summary
  // --------------------------------------------------------------------------

  function describeField(field) {
    var labelText = normalizeVisibleText(findLabelText(field));

    if (labelText !== "") {
      return truncate(labelText, 60);
    }

    var ariaLabel = field.getAttribute("aria-label");
    if (ariaLabel) {
      return truncate(ariaLabel, 60);
    }

    var name = field.getAttribute("name");
    if (name) {
      return truncate(name, 60);
    }

    if (field.id) {
      return truncate(field.id, 60);
    }

    return "(unnamed " + field.tagName.toLowerCase() + ")";
  }

  function truncate(text, limit) {
    if (text.length <= limit) {
      return text;
    }

    return text.slice(0, limit - 1) + "…";
  }

  // --------------------------------------------------------------------------
  // The main run
  // --------------------------------------------------------------------------

  // Clean up after an earlier click: take the box away and turn off any highlight
  // still showing. Without this, a second click would leave two boxes stacked up.
  function clearPreviousRun() {
    removeToast();

    var stillLit = document.querySelectorAll("." + HIGHLIGHT_CLASS + ", ." + FADING_CLASS);

    for (var i = 0; i < stillLit.length; i++) {
      stillLit[i].classList.remove(HIGHLIGHT_CLASS);
      stillLit[i].classList.remove(FADING_CLASS);
    }
  }

  function run(profile) {
    clearPreviousRun();

    var fields = document.querySelectorAll("input, textarea, select");

    // What was filled, so stage 4 can highlight these and offer an undo.
    var filled = [];
    var skipped = [];

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var decision = decideForField(field, profile);

      if (decision.action === "skip") {
        skipped.push({ field: describeField(field), reason: decision.reason });
        continue;
      }

      var previousValue = field.value;

      if (decision.option !== null) {
        selectOption(field, decision.option);
      } else {
        setFieldValue(field, profile[decision.key]);
      }

      filled.push({
        field: describeField(field),
        answer: decision.key,
        matchedOn: decision.signal,
        element: field,
        previousValue: previousValue,
      });
    }

    reportToConsole(filled, skipped);

    if (filled.length > 0) {
      highlightFields(filled);
      showToast(
        "Rote filled " + filled.length + " field(s), left " + skipped.length + " alone.",
        filled
      );
    } else {
      showToast(
        "Rote filled nothing here. The console lists why each field was left alone.",
        []
      );
    }
  }

  // The console keeps the detail: which answer went where, which signal matched it,
  // and the reason behind every skip. The box in the corner only carries the count.
  function reportToConsole(filled, skipped) {
    console.log(
      "%cRote: filled " + filled.length + ", left alone " + skipped.length,
      "font-weight: bold"
    );

    if (filled.length > 0) {
      var filledRows = [];
      for (var i = 0; i < filled.length; i++) {
        filledRows.push({
          field: filled[i].field,
          answer: filled[i].answer,
          matchedOn: filled[i].matchedOn,
        });
      }
      console.log("Filled:");
      console.table(filledRows);
    }

    if (skipped.length > 0) {
      console.log("Left alone:");
      console.table(skipped);
    }
  }

  // Read the answers, then go. Everything above is just definitions; this is the
  // line that starts the work.
  chrome.storage.local.get({ roteProfile: {} }, function (stored) {
    var profile = stored[STORAGE_KEY];
    var hasAnyAnswer = false;

    for (var key in profile) {
      if (key !== "schemaVersion" && typeof profile[key] === "string" && profile[key].trim() !== "") {
        hasAnyAnswer = true;
        break;
      }
    }

    if (!hasAnyAnswer) {
      console.log(
        "Rote: no answers saved yet. Right-click the Rote toolbar icon and choose " +
          "Options to add them."
      );
      clearPreviousRun();
      showToast("No answers saved yet — right-click the Rote icon and choose Options.", []);
      return;
    }

    run(profile);
  });
})();
