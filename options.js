// Rote — options page logic.
//
// Everything here runs on the extension's own options page. There is no network
// code in this file and there must never be any: the values below include a home
// address, a phone number and salary figures.
//
// Where the data lives: chrome.storage.local, under a single key, as one flat
// object of strings.

// The single key everything is stored under.
var STORAGE_KEY = "roteProfile";

// Bumped only if the shape of the stored object ever has to change. It is written
// into exports so a future version can tell old files from new ones.
var SCHEMA_VERSION = 1;

// The complete list of answers Rote stores.
// Each string here must match:
//   1. the id and name of an input in options.html, and
//   2. the key used by the rules table in rules.js (stage 3).
// Adding a new answer means adding it in all three places.
var PROFILE_KEYS = [
  // contact
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "country",
  // the repetitive ones
  "noticePeriod",
  "currentCtc",
  "expectedCtc",
  "yearsExperience",
  "workAuthorization",
  "willingToRelocate",
  "preferredLocation",
  "howHeard",
  // links
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
];

// Refuse to read an "import" file bigger than this. A real profile is well under
// 4 KB, so anything large is either the wrong file or something odd.
var MAX_IMPORT_BYTES = 1024 * 1024; // 1 MB

// Grab the page elements once, after the page has loaded.
var form = document.getElementById("profile_form");
var statusMessage = document.getElementById("status_message");
var importReport = document.getElementById("import_report");
var exportButton = document.getElementById("export_button");
var importButton = document.getElementById("import_button");
var importFileInput = document.getElementById("import_file");
var clearButton = document.getElementById("clear_button");

// ---------------------------------------------------------------------------
// Reading and writing the form
// ---------------------------------------------------------------------------

// Collect what is currently typed into the form, as a plain object of strings.
// Values are trimmed, because a stray space at the end of an email address is the
// kind of thing that quietly fails a form's validation.
function readFormValues() {
  var values = {};

  for (var i = 0; i < PROFILE_KEYS.length; i++) {
    var key = PROFILE_KEYS[i];
    var input = document.getElementById(key);

    if (input === null) {
      // A key in PROFILE_KEYS with no matching input means the two lists have
      // drifted apart. Say so loudly in the console rather than failing silently.
      console.warn("Rote: no input on the options page for key:", key);
      continue;
    }

    values[key] = input.value.trim();
  }

  return values;
}

// Put a stored profile back into the form. Any key that is missing from the
// stored object becomes an empty input rather than being left as it was.
function writeFormValues(profile) {
  for (var i = 0; i < PROFILE_KEYS.length; i++) {
    var key = PROFILE_KEYS[i];
    var input = document.getElementById(key);

    if (input === null) {
      continue;
    }

    if (typeof profile[key] === "string") {
      input.value = profile[key];
    } else {
      input.value = "";
    }
  }
}

// ---------------------------------------------------------------------------
// Talking to chrome.storage.local
// ---------------------------------------------------------------------------

// Load the saved profile into the form. Called once when the page opens.
function loadProfileIntoForm() {
  // Passing an object to get() supplies a default: if nothing has been saved yet,
  // roteProfile comes back as an empty object instead of undefined.
  chrome.storage.local.get({ roteProfile: {} }, function (stored) {
    writeFormValues(stored.roteProfile);
  });
}

// Save whatever is in the form right now.
function saveProfileFromForm() {
  var values = readFormValues();
  values.schemaVersion = SCHEMA_VERSION;

  var toStore = {};
  toStore[STORAGE_KEY] = values;

  chrome.storage.local.set(toStore, function () {
    if (chrome.runtime.lastError) {
      showStatus("Could not save: " + chrome.runtime.lastError.message, true);
      return;
    }

    var filledCount = countFilledAnswers(values);
    showStatus("Saved — " + filledCount + " of " + PROFILE_KEYS.length + " answers filled in", false);
  });
}

// How many answers actually have something in them. Empty answers are never used
// to fill a form, so this is the number that matters.
function countFilledAnswers(values) {
  var count = 0;

  for (var i = 0; i < PROFILE_KEYS.length; i++) {
    var value = values[PROFILE_KEYS[i]];
    if (typeof value === "string" && value !== "") {
      count = count + 1;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Status messages
// ---------------------------------------------------------------------------

function showStatus(message, isError) {
  statusMessage.textContent = message;

  if (isError) {
    statusMessage.classList.add("error");
  } else {
    statusMessage.classList.remove("error");
  }
}

function showImportReport(message, isError) {
  importReport.textContent = message;

  if (isError) {
    importReport.classList.add("error");
  } else {
    importReport.classList.remove("error");
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

// Write the saved profile to a JSON file in the downloads folder.
//
// This uses a "blob URL", which is a URL pointing at data held in this page's own
// memory. Despite looking like a URL, nothing is sent anywhere — the browser
// hands the bytes straight to the download.
function exportProfile() {
  chrome.storage.local.get({ roteProfile: {} }, function (stored) {
    var profile = stored.roteProfile;

    // Make sure the export always carries a version, even if what was stored
    // predates it.
    if (typeof profile.schemaVersion !== "number") {
      profile.schemaVersion = SCHEMA_VERSION;
    }

    var json = JSON.stringify(profile, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var blobUrl = URL.createObjectURL(blob);

    // The filename deliberately starts with "rote-profile" because .gitignore in
    // this repo ignores rote-profile*.json — so an export saved into the project
    // folder by accident still cannot be committed.
    var link = document.createElement("a");
    link.href = blobUrl;
    link.download = "rote-profile-" + todayAsIsoDate() + ".json";
    link.click();

    // Release the memory the blob was using.
    URL.revokeObjectURL(blobUrl);

    showImportReport("Exported " + countFilledAnswers(profile) + " answers.", false);
  });
}

// Today's date as YYYY-MM-DD, for the export filename.
function todayAsIsoDate() {
  var now = new Date();
  var year = now.getFullYear();
  var month = String(now.getMonth() + 1).padStart(2, "0");
  var day = String(now.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

// Read a JSON file the user picked, check it carefully, then load it into the
// form and save it.
function importProfileFromFile(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    showImportReport(
      "That file is " + Math.round(file.size / 1024) + " KB, which is far too big " +
        "for a Rote profile. Nothing was imported.",
      true
    );
    return;
  }

  var reader = new FileReader();

  reader.onerror = function () {
    showImportReport("Could not read that file. Nothing was imported.", true);
  };

  reader.onload = function () {
    var parsed;

    // A file the user picked could be anything at all, so parsing has to be
    // wrapped in try/catch — a bad file must not break the page.
    try {
      parsed = JSON.parse(reader.result);
    } catch (error) {
      showImportReport("That file is not valid JSON. Nothing was imported.", true);
      return;
    }

    // typeof null is also "object", and arrays are objects too, so both need
    // ruling out explicitly.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      showImportReport(
        "That JSON file is not a Rote profile — it should be a single object of " +
          "answers. Nothing was imported.",
        true
      );
      return;
    }

    applyImportedProfile(parsed);
  };

  reader.readAsText(file);
}

// Copy the recognised answers out of an imported object, ignoring everything else,
// then save. Anything unexpected is reported rather than silently dropped.
function applyImportedProfile(parsed) {
  var cleaned = {};
  var importedCount = 0;
  var skippedKeys = [];

  // Only keys Rote knows about are copied across. This is what stops a strange
  // file from putting unexpected data into storage.
  for (var i = 0; i < PROFILE_KEYS.length; i++) {
    var key = PROFILE_KEYS[i];
    var value = parsed[key];

    if (typeof value === "string") {
      cleaned[key] = value.trim();
      if (cleaned[key] !== "") {
        importedCount = importedCount + 1;
      }
    } else if (typeof value === "number") {
      // Someone hand-editing the file might write yearsExperience: 6 without
      // quotes. That is easy to accept.
      cleaned[key] = String(value);
      importedCount = importedCount + 1;
    } else {
      cleaned[key] = "";
    }
  }

  // Note anything in the file that Rote does not recognise, so a typo'd key
  // doesn't look like it worked.
  var parsedKeys = Object.keys(parsed);
  for (var j = 0; j < parsedKeys.length; j++) {
    var parsedKey = parsedKeys[j];
    if (parsedKey !== "schemaVersion" && PROFILE_KEYS.indexOf(parsedKey) === -1) {
      skippedKeys.push(parsedKey);
    }
  }

  cleaned.schemaVersion = SCHEMA_VERSION;

  var toStore = {};
  toStore[STORAGE_KEY] = cleaned;

  chrome.storage.local.set(toStore, function () {
    if (chrome.runtime.lastError) {
      showImportReport("Could not save the import: " + chrome.runtime.lastError.message, true);
      return;
    }

    writeFormValues(cleaned);

    var report = "Imported " + importedCount + " answers.";

    if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion !== SCHEMA_VERSION) {
      report = report + "\nThat file says schemaVersion " + parsed.schemaVersion +
        ", this version of Rote uses " + SCHEMA_VERSION + ". Check the answers above look right.";
    }

    if (skippedKeys.length > 0) {
      report = report + "\nIgnored " + skippedKeys.length + " unrecognised key(s): " +
        skippedKeys.join(", ");
    }

    showImportReport(report, false);
    showStatus("", false);
  });
}

// ---------------------------------------------------------------------------
// Erase
// ---------------------------------------------------------------------------

function clearProfile() {
  var confirmed = window.confirm(
    "Erase every answer stored on this computer?\n\nThis cannot be undone. If you " +
      "might want them back, cancel and export first."
  );

  if (!confirmed) {
    return;
  }

  chrome.storage.local.remove(STORAGE_KEY, function () {
    if (chrome.runtime.lastError) {
      showStatus("Could not erase: " + chrome.runtime.lastError.message, true);
      return;
    }

    writeFormValues({});
    showStatus("Erased. Nothing is stored.", false);
    showImportReport("", false);
  });
}

// ---------------------------------------------------------------------------
// Wiring the buttons up
// ---------------------------------------------------------------------------

// Submitting the form (the Save button, or Enter in any field) saves.
form.addEventListener("submit", function (event) {
  // Without this the page would try to navigate, which on an extension page just
  // reloads it and loses the edit.
  event.preventDefault();
  saveProfileFromForm();
});

// As soon as anything is edited, replace "Saved" with a reminder that it isn't.
form.addEventListener("input", function () {
  showStatus("Not saved yet", false);
});

exportButton.addEventListener("click", exportProfile);

// The real file input is hidden because file inputs cannot be styled; the visible
// button clicks it instead.
importButton.addEventListener("click", function () {
  importFileInput.click();
});

importFileInput.addEventListener("change", function () {
  if (importFileInput.files.length === 0) {
    return;
  }

  importProfileFromFile(importFileInput.files[0]);

  // Clear the file input so picking the same file twice in a row still fires a
  // change event.
  importFileInput.value = "";
});

clearButton.addEventListener("click", clearProfile);

// Finally, fill the form with whatever was saved last time.
loadProfileIntoForm();
