# Rote — sample resume generator. Development tool, not part of the extension.
#
#   Run it:  python3 tools/make-sample-resume.py
#
# Writes test/fixtures/sample-resume.pdf: a plausible but entirely invented resume,
# for testing the "hand me a resume, get back an import file" flow without using a
# real one. Every detail in it is fake, including the person.
#
# It writes the PDF by hand — objects, cross-reference table, trailer — because
# adding a PDF library would break the no-dependencies rule. Text only, one page,
# Helvetica, which is one of the fonts every PDF reader is required to have built in.

import os

PAGE_WIDTH = 595   # A4 at 72 points per inch
PAGE_HEIGHT = 842
LEFT = 56
TOP = 786

# (text, font size, bold?, space above in points)
LINES = [
    ("Asha Menon", 20, True, 0),
    ("Senior Backend Engineer", 12, False, 4),
    ("12 Jayanagar 4th Block, Bengaluru, Karnataka 560011, India", 10, False, 12),
    ("+91 98450 12345  |  asha.menon@example.com", 10, False, 3),
    ("linkedin.com/in/ashamenon  |  github.com/ashamenon  |  ashamenon.dev", 10, False, 3),

    ("SUMMARY", 11, True, 20),
    ("Backend engineer with 7 years building payments and billing systems at scale.", 10, False, 6),
    ("Comfortable owning a service end to end, from schema design to on-call.", 10, False, 3),

    ("EXPERIENCE", 11, True, 18),
    ("Zeta Payments  -  Staff Software Engineer", 10, True, 8),
    ("Bengaluru  |  February 2023 - Present", 9, False, 3),
    ("- Led the rewrite of the settlement ledger, cutting month-end close from", 10, False, 5),
    ("  nine hours to under twenty minutes.", 10, False, 2),
    ("- Designed the idempotency layer now used by every payment write path.", 10, False, 2),

    ("Flipkart  -  Senior Software Engineer", 10, True, 12),
    ("Bengaluru  |  July 2020 - January 2023", 9, False, 3),
    ("- Owned the seller payouts service through three Big Billion Days peaks.", 10, False, 5),
    ("- Moved reconciliation from nightly batch to streaming on Kafka.", 10, False, 2),

    ("Infosys  -  Software Engineer", 10, True, 12),
    ("Bengaluru  |  July 2019 - June 2020", 9, False, 3),
    ("- Built internal reporting tooling for a retail banking client.", 10, False, 5),

    ("EDUCATION", 11, True, 18),
    ("B.E. Computer Science, RV College of Engineering, Bengaluru  -  2019", 10, False, 6),

    ("SKILLS", 11, True, 18),
    ("Go, Python, PostgreSQL, Kafka, Kubernetes, AWS, Terraform", 10, False, 6),
]


def escape(text):
    """Backslash, brackets and non-ASCII need care inside a PDF string."""
    out = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    return out.encode("latin-1", "replace")


def build_content():
    """The page's drawing instructions: position the cursor, then show text."""
    parts = []
    y = TOP

    for text, size, bold, space_above in LINES:
        y -= space_above + size
        font = b"/F2" if bold else b"/F1"
        parts.append(
            b"BT " + font + b" " + str(size).encode() + b" Tf "
            + str(LEFT).encode() + b" " + str(y).encode() + b" Td ("
            + escape(text) + b") Tj ET\n"
        )

    return b"".join(parts)


def build_pdf():
    content = build_content()

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
        b"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"
        % (PAGE_WIDTH, PAGE_HEIGHT),
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []

    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    # The cross-reference table tells a reader the byte offset of every object.
    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset

    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref_at,
    )

    return bytes(out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(os.path.dirname(here), "test", "fixtures", "sample-resume.pdf")

    with open(target, "wb") as handle:
        handle.write(build_pdf())

    print("wrote", os.path.relpath(target, os.path.dirname(here)))
