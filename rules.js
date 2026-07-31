// Rote — the keyword rules table.
//
// This file is data, not logic. fill.js does the work; this file only says which
// words identify which answer. It is meant to be edited by hand.
//
// Each rule has four parts:
//
//   key          Which stored answer this rule is about. Must exactly match a key
//                in PROFILE_KEYS in options.js.
//   autocomplete Browser autocomplete tokens, e.g. "given-name". These are checked
//                first because a form that sets them is telling the truth about
//                what the field is. Matched exactly, never as a fragment.
//   match        Words that identify the field. Matched as a fragment: the pattern
//                "notice period" matches the label "What is your notice period?".
//   exclude      Words that mean "this looks right but isn't". If a match pattern
//                hits AND an exclude pattern also appears in the same text, this
//                rule is thrown out for that field.
//
// About spaces in patterns: before comparing, both the pattern and the text being
// searched get cleaned up the same way. When searching an attribute like
// name="current_ctc", all punctuation is removed from both sides, so the pattern
// "current ctc" becomes "currentctc" and matches. When searching visible text like
// "Current CTC (annual)", punctuation becomes spaces on both sides, so the same
// pattern matches there too. One pattern list covers both.
//
// Two rules of thumb when adding patterns:
//
//   1. Keep patterns four characters or longer, and prefer two-word phrases. Short
//      fragments match by accident: "city" is hidden inside "capacity", and Lever's
//      field names contain long hex strings that can contain almost anything.
//   2. If you are ever unsure, leave the pattern out. A field Rote skips costs you
//      one line of typing. A field Rote fills wrongly costs you an application.

var ROTE_RULES = [
  // ------------------------------------------------------------------ contact
  {
    key: "firstName",
    autocomplete: ["given-name"],
    match: ["first name", "given name", "forename"],
    exclude: [],
  },
  {
    key: "lastName",
    autocomplete: ["family-name"],
    match: ["last name", "surname", "family name"],
    exclude: [],
  },
  {
    key: "fullName",
    autocomplete: ["name"],
    // Deliberately no bare "name" pattern — it appears inside "company name",
    // "file name", "username" and plenty more. Lever's single name field sets
    // autocomplete="name", which catches it at the first signal anyway.
    match: ["full name", "your name", "legal name"],
    exclude: ["first", "last", "company", "file", "user", "referr", "manager"],
  },
  {
    key: "email",
    autocomplete: ["email"],
    match: ["email", "e mail"],
    exclude: ["confirm", "again", "re enter", "reenter", "alternate", "secondary", "emergency", "parent"],
  },
  {
    key: "phone",
    autocomplete: ["tel", "tel-national"],
    match: ["phone", "mobile", "telephone", "contact number"],
    exclude: ["confirm", "alternate", "secondary", "emergency", "parent"],
  },
  {
    key: "addressLine1",
    autocomplete: ["address-line1", "street-address"],
    match: ["street address", "address line 1", "address 1", "mailing address", "address"],
    // "address" on its own is broad, so the exclude list has to carry real weight
    // here: "Email address" must go to the email rule, not to this one.
    exclude: ["email", "e mail", "line 2", "address 2", "website", "url", "linkedin", "github"],
  },
  {
    key: "city",
    autocomplete: ["address-level2"],
    match: ["city", "town"],
    // "capacity" contains "city". This is exactly what excludes are for.
    exclude: ["capacity"],
  },
  {
    key: "state",
    autocomplete: ["address-level1"],
    match: ["state", "province", "region"],
    // "state" hides inside "estate" and "statement", and — the one that actually
    // bites — inside "United States", which appears in every US work
    // authorization question. Without these, those questions match two rules and
    // get skipped.
    exclude: ["estate", "statement", "united states", "authoriz", "authoris", "eligib", "visa", "sponsor"],
  },
  {
    key: "postalCode",
    autocomplete: ["postal-code"],
    match: ["postal code", "postcode", "zip", "pin code", "pincode"],
    exclude: [],
  },
  {
    key: "country",
    autocomplete: ["country", "country-name"],
    match: ["country"],
    exclude: [],
  },

  // --------------------------------------------------- the repetitive ones
  {
    key: "noticePeriod",
    autocomplete: [],
    match: [
      "notice period",
      "notice",
      "when can you start",
      "earliest start date",
      "availability to start",
      "joining time",
    ],
    exclude: ["noticed"],
  },
  {
    key: "currentCtc",
    autocomplete: [],
    match: [
      "current ctc",
      "current salary",
      "current compensation",
      "current annual",
      "current fixed",
      "present ctc",
      "present salary",
      "ctc current", // catches attributes like name="ctc_current_lpa"
    ],
    // The most important line in this file. Anything hinting at a future or wished
    // for number disqualifies the field from receiving the current one.
    exclude: ["expect", "desired", "asking", "preferred", "previous", "last drawn"],
  },
  {
    key: "expectedCtc",
    autocomplete: [],
    match: [
      "expected ctc",
      "expected salary",
      "expected compensation",
      "expected annual",
      "expected pay",
      "salary expectation",
      "compensation expectation",
      "desired salary",
      "desired ctc",
      "ctc expected",
    ],
    // The mirror image of the rule above. Together these two mean a single box
    // asking for both numbers gets nothing, which is the point.
    exclude: ["current", "present", "previous", "last drawn"],
  },
  {
    key: "yearsExperience",
    autocomplete: [],
    match: [
      "years of experience",
      "years experience",
      "total years",
      "total experience",
      "overall experience",
      "experience in years",
      "yrs of experience",
    ],
    // Forms often ask "how many years of experience with Kubernetes?", which wants
    // a different number entirely. The first four entries catch the whole family
    // by their phrasing. The technology names after them catch the "...experience
    // in Python?" phrasing, which has no giveaway words — that list is meant to be
    // added to whenever a new one turns up in the wild.
    //
    // Note the deliberate absence of "experience in": it would also throw out the
    // perfectly good label "Experience (in years)".
    exclude: [
      "experience with",
      "experience using",
      "years with",
      "years using",
      "python",
      "java",
      "javascript",
      "typescript",
      "golang",
      "rust",
      "react",
      "node",
      "kubernetes",
      "docker",
      "terraform",
      "salesforce",
      "aws",
      "azure",
      "management",
      "leading",
    ],
  },
  {
    key: "workAuthorization",
    autocomplete: [],
    match: [
      "work authorization",
      "work authorisation",
      "authorized to work",
      "authorised to work",
      "legally authorized",
      "legally authorised",
      "right to work",
      "eligible to work",
      "work eligibility",
      "work permit",
      "require sponsorship",
      "need sponsorship",
      "visa status",
      "work status",
    ],
    exclude: [],
  },
  {
    key: "willingToRelocate",
    autocomplete: [],
    match: ["willing to relocate", "open to relocation", "relocate", "relocation"],
    // "Do you need relocation assistance?" is a different question with a
    // different answer.
    exclude: ["assistance", "package", "reimburse", "cost", "budget"],
  },
  {
    key: "preferredLocation",
    autocomplete: [],
    // No bare "location" pattern, on purpose. Lever's own location field is a
    // custom autocomplete widget: typing into it without picking from its dropdown
    // leaves the form in a broken state, so a field labelled just "Location" must
    // match nothing at all.
    match: [
      "preferred location",
      "preferred work location",
      "location preference",
      "preferred city",
      "preferred office",
      "which location",
      "work location",
    ],
    exclude: [],
  },
  {
    key: "howHeard",
    autocomplete: [],
    match: [
      "how did you hear",
      "how did you find",
      "where did you hear",
      "how you heard",
      "referral source",
      "source", // Lever's own field is name="source"
    ],
    exclude: ["open source", "sourcing", "source code", "sourced"],
  },

  // -------------------------------------------------------------------- links
  {
    key: "linkedinUrl",
    autocomplete: [],
    match: ["linkedin"],
    exclude: [],
  },
  {
    key: "githubUrl",
    autocomplete: [],
    match: ["github", "git hub"],
    exclude: [],
  },
  {
    key: "portfolioUrl",
    autocomplete: [],
    match: ["portfolio", "personal website", "personal site", "website", "web site", "blog"],
    exclude: ["company website", "employer"],
  },
];
