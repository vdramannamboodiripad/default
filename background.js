// Rote — background service worker.
//
// Its only job: when the toolbar button is clicked, inject the rules table and the
// filler into whatever page is open.
//
// Nothing is injected until the button is clicked. Rote has no host permissions, so
// it cannot read any page you have not explicitly pointed it at — the click itself
// is what grants access, and only to that one tab, and only for that moment.

// The order matters: rules.js defines ROTE_RULES, which fill.js reads.
var FILES_TO_INJECT = ["rules.js", "fill.js"];

// chrome.action.onClicked only fires when the manifest has no "default_popup",
// which is deliberate: filling should be one click, not a click and then a menu.
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      files: FILES_TO_INJECT,
    })
    .catch(function (error) {
      // Chrome blocks injection on its own pages (chrome://…, the Web Store), and
      // on file:// pages unless "Allow access to file URLs" is switched on for Rote
      // in chrome://extensions. Neither is a bug in Rote, but neither is visible to
      // you either, so mark the icon and explain in the console.
      console.error("Rote: could not run on this page —", error.message);
      showProblemBadge(tab.id);
    });
});

// A small "!" on the toolbar icon, so a failed click doesn't look identical to a
// click that simply found nothing to fill.
function showProblemBadge(tabId) {
  chrome.action.setBadgeBackgroundColor({ color: "#b3261e", tabId: tabId });
  chrome.action.setBadgeText({ text: "!", tabId: tabId });

  // Clear it after a few seconds. If the service worker is shut down before this
  // runs the badge stays until the tab navigates, which is untidy but harmless.
  setTimeout(function () {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }, 6000);
}
