// Rote — rules check. Development tool, not part of the extension.
//
//   Run it:  node test/check-rules.js        (needs node and python3 on your PATH)
//
// It prints what Rote would do to every field in every fixture, and why. It is not
// a substitute for clicking the button in Chrome — it cannot test injection, event
// dispatch, React, highlighting or undo. What it does test is the part most likely
// to be quietly wrong: whether the keyword rules in rules.js pick the right answer
// for each field, and refuse the ambiguous ones.
//
// How it avoids grading its own homework: the rules table is loaded from rules.js,
// and the matching functions are sliced out of fill.js source rather than re-typed,
// so this really does exercise the shipping code. Two things it does have its own
// copy of, because they touch the DOM or the filesystem:
//
//   - the signal walk (the decide function below) mirrors decideForField in fill.js
//   - the field data comes from test/extract-fields.py, which mirrors findLabelText
//
// If you change either of those in fill.js, change them here too, or this will
// cheerfully report on behaviour the extension no longer has.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repo = path.resolve(__dirname, "..");
const fixtures = ["greenhouse.html", "lever.html", "ctc-adjacent.html"].map((name) =>
  path.join("test", "fixtures", name)
);

// --- the real rules table -------------------------------------------------
const rulesSource = fs.readFileSync(`${repo}/rules.js`, "utf8");
// new Function gives the file its own scope, so its `var ROTE_RULES` doesn't clash.
var ROTE_RULES = new Function(rulesSource + "; return ROTE_RULES;")();

// --- the real matching functions, taken verbatim from fill.js -------------
const fillSource = fs.readFileSync(`${repo}/fill.js`, "utf8");
const start = fillSource.indexOf("function normalizeAttribute");
const end = fillSource.indexOf("// Reading the label attached to a field");
if (start === -1 || end === -1) {
  console.error("Could not locate the matching functions in fill.js — markers moved.");
  process.exit(1);
}
const matchingSource = fillSource.slice(start, end);

// findAutocompleteMatches takes an element; give it something with getAttribute.
eval(matchingSource);

const ALLOWED_INPUT_TYPES = ["text", "email", "tel", "url", "number", "search", ""];

function fakeElement(field) {
  return {
    getAttribute(attribute) {
      if (attribute === "autocomplete") return field.autocomplete;
      if (attribute === "aria-label") return field.ariaLabel;
      if (attribute === "placeholder") return field.placeholder;
      if (attribute === "name") return field.name;
      return null;
    },
  };
}

// Mirrors decideForField in fill.js. Keep in step by hand.
function decide(field, profile) {
  if (field.tag === "input" && ALLOWED_INPUT_TYPES.indexOf(field.type) === -1) {
    return { action: "skip", reason: "input type is " + field.type };
  }
  if (field.disabled) return { action: "skip", reason: "disabled" };
  if (field.readonly) return { action: "skip", reason: "read only" };
  if (field.type === "hidden") return { action: "skip", reason: "not visible" };
  if (field.value && field.value.trim() !== "") {
    return { action: "skip", reason: "already has a value" };
  }

  const element = fakeElement(field);
  const signals = [
    { name: "autocomplete", matches: findAutocompleteMatches(element) },
    { name: "name attribute", matches: findRuleMatches(field.name, normalizeAttribute) },
    { name: "id attribute", matches: findRuleMatches(field.id, normalizeAttribute) },
    { name: "label", matches: findRuleMatches(field.labelText, normalizeVisibleText) },
    { name: "aria-label", matches: findRuleMatches(field.ariaLabel, normalizeVisibleText) },
    { name: "placeholder", matches: findRuleMatches(field.placeholder, normalizeVisibleText) },
  ];

  let winning = null;
  for (const signal of signals) {
    if (signal.matches.hitKeys.length > 0) {
      winning = signal;
      break;
    }
  }
  if (winning === null) return { action: "skip", reason: "no rule matched" };

  const allowed = winning.matches.allowedKeys;
  if (allowed.length === 0) {
    return {
      action: "skip",
      reason: `matched ${winning.matches.hitKeys.join(" and ")} on the ${winning.name}, but an exclude word ruled it out`,
    };
  }
  if (allowed.length > 1) {
    return {
      action: "skip",
      reason: `ambiguous — matched ${allowed.join(" and ")} on the ${winning.name}`,
    };
  }

  const matchedKey = allowed[0];

  // Mirrors the dropdownKey branch in fill.js.
  let key = matchedKey;
  if (field.tag === "select") {
    const matchedRule = ROTE_RULES.find((rule) => rule.key === matchedKey);
    if (matchedRule && matchedRule.dropdownKey) {
      key = matchedRule.dropdownKey;
    }
  }

  const answer = profile[key];
  if (typeof answer !== "string" || answer.trim() === "") {
    return { action: "skip", reason: `matched ${key}, but that answer is empty` };
  }
  if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(answer.trim())) {
    return { action: "skip", reason: `matched ${key}, but this is a number field and "${answer}" is not a plain number` };
  }
  if (field.maxlength && Number(field.maxlength) > 0 && answer.length > Number(field.maxlength)) {
    return { action: "skip", reason: `matched ${key}, but the answer is longer than the field allows` };
  }
  if (field.tag === "select") {
    const wanted = normalizeVisibleText(answer);
    const option = field.options.find(
      (o) => normalizeVisibleText(o.text) === wanted || (o.value && normalizeVisibleText(o.value) === wanted)
    );
    if (!option) {
      return { action: "skip", reason: `matched ${key}, but no dropdown option reads exactly "${answer}"` };
    }
    return { action: "fill", key, signal: winning.name, sets: `option "${option.text}" (value ${option.value})` };
  }
  return { action: "fill", key, signal: winning.name, sets: answer };
}

// Obviously fake profile, matching the shape options.js stores.
const profile = {
  schemaVersion: 1,
  firstName: "Asha",
  lastName: "Menon",
  fullName: "Asha Menon",
  email: "asha.menon@example.com",
  phone: "+91 98000 00000",
  addressLine1: "12 Example Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  country: "India",
  noticePeriod: "30 days",
  currentCtc: "18 LPA",
  expectedCtc: "26 LPA",
  yearsExperience: "6",
  workAuthorization: "Indian citizen, no sponsorship required",
  workAuthorizationYesNo: "Yes",
  willingToRelocate: "Yes",
  preferredLocation: "Bengaluru / Remote",
  howHeard: "Company careers page",
  linkedinUrl: "https://www.linkedin.com/in/example",
  githubUrl: "https://github.com/example",
  portfolioUrl: "https://example.com",
};

// Parse the fixtures with the Python helper next door, which uses a real HTML
// parser rather than anything hand-rolled.
const extracted = execFileSync(
  "python3",
  [path.join(repo, "test", "extract-fields.py")].concat(fixtures),
  { cwd: repo, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
);
const byFixture = JSON.parse(extracted);

for (const [fixture, fields] of Object.entries(byFixture)) {
  console.log("\n=== " + fixture + " ===");
  let filled = 0;
  for (const field of fields) {
    const label = field.labelText || field.ariaLabel || field.placeholder || field.name || field.id;
    const decision = decide(field, profile);
    if (decision.action === "fill") {
      filled++;
      console.log(`  FILL  ${String(label).slice(0, 46).padEnd(48)} <- ${decision.key} (${decision.signal})`);
    } else {
      console.log(`  skip  ${String(label).slice(0, 46).padEnd(48)} :: ${decision.reason}`);
    }
  }
  console.log(`  --- filled ${filled} of ${fields.length}`);
}
