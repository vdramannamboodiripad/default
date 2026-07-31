// Rote — background service worker.
//
// STAGE 1 STUB. Right now this file only proves the extension loads and that the
// toolbar button is wired up. The real job of this file (stage 3) is: when the
// toolbar button is clicked, inject rules.js and fill.js into the current tab.

// chrome.action.onClicked fires when the toolbar button is clicked. It only fires
// when the manifest has no "default_popup", which is what we want: one click
// should fill the form, not open a menu.
chrome.action.onClicked.addListener(function (tab) {
  // Stage 3 replaces this with chrome.scripting.executeScript.
  console.log("Rote: toolbar clicked on tab", tab.id, tab.url);
  console.log("Rote: no fill logic yet — this is the stage 1 stub.");
});
