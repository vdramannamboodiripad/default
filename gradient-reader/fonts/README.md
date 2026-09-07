# fonts/

Empty on purpose. The two fonts the settings page offers are not in this repo,
because neither of them is mine to redistribute without a decision from you.

Both are freely licensed and both are meant to be **bundled rather than linked**.
Linking to Google Fonts or any other host would mean a network request on every
page you read, which would break the one promise this extension makes — and the
manifest has no network permission, so the request would simply fail anyway.

## What to add

| Setting | Filename it looks for |
| --- | --- |
| Atkinson Hyperlegible | `AtkinsonHyperlegible-Regular.woff2` |
| OpenDyslexic | `OpenDyslexic-Regular.woff2` |

Drop the `.woff2` files in this directory with exactly those names. Nothing else
needs changing — `content.js` builds the `@font-face` rule from
`chrome.runtime.getURL()`, so the file is served from inside the extension.

- **Atkinson Hyperlegible** — Braille Institute of America, SIL Open Font
  License 1.1. Designed for low vision, with letterforms drawn to be
  unmistakable for one another.
- **OpenDyslexic** — Abelardo Gonzalez, SIL Open Font License 1.1.
  Bottom-weighted letterforms. Some readers find it helps a great deal and
  others find it unreadable, which is the usual shape of things here.

## If you skip this

Nothing breaks. The `@font-face` rule tries `local()` first, so if you already
have either font installed on your system it is used from there and no file is
needed at all. Failing that the rule quietly does nothing and the fallback in
`settings.js` takes over — Verdana, which is a reasonable wide sans and is on
every machine.

The settings page says which of these is happening, under the font selector, so
you are not left wondering why nothing changed.

## Licence files

If you do add the fonts, put their `OFL.txt` next to them. Both licences require
the copyright notice to travel with the font, and a bundled font in a Chrome
extension is redistribution.
