# Dev-only helper. Parses the fixtures and dumps, for each form field, exactly the
# strings fill.js would look at: autocomplete, name, id, label text, aria-label,
# placeholder — plus dropdown options and the skip-relevant attributes.
# Not part of the extension.

import json
import sys
from html.parser import HTMLParser

FIELD_TAGS = {"input", "textarea", "select"}


class FieldExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.fields = []
        self.label_stack = []          # open <label> elements: [ [id, [text parts]] ]
        self.label_text_by_id = {}     # label id -> full text
        self.label_for = {}            # for-attribute -> label id
        self.next_label_id = 0
        self.open_select = None
        self.open_option = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)

        if tag == "label":
            label_id = self.next_label_id
            self.next_label_id += 1
            self.label_stack.append([label_id, []])
            if "for" in attrs:
                self.label_for[attrs["for"]] = label_id
            return

        if tag == "option" and self.open_select is not None:
            self.open_option = {"value": attrs.get("value"), "text": []}
            return

        if tag not in FIELD_TAGS:
            return

        field = {
            "tag": tag,
            "type": attrs.get("type", "" if tag == "input" else tag),
            "name": attrs.get("name"),
            "id": attrs.get("id"),
            "autocomplete": attrs.get("autocomplete"),
            "ariaLabel": attrs.get("aria-label"),
            "placeholder": attrs.get("placeholder"),
            "value": attrs.get("value", ""),
            "disabled": "disabled" in attrs,
            "readonly": "readonly" in attrs,
            "maxlength": attrs.get("maxlength"),
            # which open <label> encloses this field, if any (the Lever shape)
            "wrappingLabel": self.label_stack[-1][0] if self.label_stack else None,
            "options": [] if tag == "select" else None,
        }
        self.fields.append(field)

        if tag == "select":
            self.open_select = field

    def handle_endtag(self, tag):
        if tag == "label" and self.label_stack:
            label_id, parts = self.label_stack.pop()
            self.label_text_by_id[label_id] = "".join(parts)
        elif tag == "option" and self.open_option is not None:
            text = "".join(self.open_option["text"]).strip()
            value = self.open_option["value"]
            self.open_select["options"].append(
                {"text": text, "value": value if value is not None else text}
            )
            self.open_option = None
        elif tag == "select":
            self.open_select = None

    def handle_data(self, data):
        # Mirrors readLabelWords in fill.js: text inside a nested form field does
        # not count as label text.
        if self.open_select is None:
            for entry in self.label_stack:
                entry[1].append(data)
        if self.open_option is not None:
            self.open_option["text"].append(data)


def extract(path):
    parser = FieldExtractor()
    with open(path, encoding="utf-8") as handle:
        parser.feed(handle.read())

    for field in parser.fields:
        # Mirror findLabelText in fill.js: <label for=id> wins, then a wrapping
        # <label>, then nothing.
        label_text = ""
        if field["id"] and field["id"] in parser.label_for:
            label_text = parser.label_text_by_id.get(parser.label_for[field["id"]], "")
        elif field["wrappingLabel"] is not None:
            label_text = parser.label_text_by_id.get(field["wrappingLabel"], "")
        field["labelText"] = " ".join(label_text.split())
        del field["wrappingLabel"]

    return parser.fields


if __name__ == "__main__":
    out = {}
    for path in sys.argv[1:]:
        out[path] = extract(path)
    print(json.dumps(out, indent=1))
