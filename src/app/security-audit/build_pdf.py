"""
Builds the redacted security-audit PDF deliverable.

Reads the four sanitized markdown files in ./_content/ and emits
Security_Audit_Report_Redacted.pdf into public/security-audit/ — the
path the page's download link expects.

Reuses the parser from build_docx.py (so the `<!-- docx:skip -->` and
`<!-- docx:skip-block -->` tags are honored identically for both outputs).

Usage (from repo root):
    python src/app/security-audit/build_pdf.py
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Reuse the markdown parser and skip-tag preprocessors
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_docx import parse_blocks, strip_docx_skip_blocks, strip_docx_skips  # noqa: E402

CONTENT_DIR = HERE / "_content"
OUTPUT_DIR = HERE.parents[2] / "public" / "security-audit"
OUTPUT_FILE = OUTPUT_DIR / "Security_Audit_Report_Redacted.pdf"


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

DARK = HexColor("#1F2937")
DARK2 = HexColor("#374151")
MUTED = HexColor("#6B7280")
PALE = HexColor("#F3F4F6")
TABLE_HEADER_BG = HexColor("#1F2937")
FOOTER = HexColor("#9CA3AF")


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "title",
            fontName="Helvetica-Bold",
            fontSize=28,
            leading=32,
            textColor=DARK,
            alignment=TA_CENTER,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            fontName="Helvetica",
            fontSize=16,
            leading=20,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "subtitle_small": ParagraphStyle(
            "subtitle_small",
            fontName="Helvetica",
            fontSize=12,
            leading=16,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "h1",
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=DARK,
            spaceBefore=14,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=18,
            textColor=DARK,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "h3",
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=DARK2,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "body",
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=DARK,
            spaceBefore=2,
            spaceAfter=6,
            alignment=TA_LEFT,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=DARK,
            leftIndent=18,
            bulletIndent=6,
            spaceBefore=1,
            spaceAfter=1,
        ),
        "cell": ParagraphStyle(
            "cell",
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=DARK,
        ),
        "cell_header": ParagraphStyle(
            "cell_header",
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=HexColor("#FFFFFF"),
        ),
        "toc_item": ParagraphStyle(
            "toc_item",
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=DARK,
            spaceBefore=2,
            spaceAfter=2,
        ),
        "footnote_head": ParagraphStyle(
            "footnote_head",
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=DARK,
            spaceBefore=0,
            spaceAfter=3,
        ),
        "footnote": ParagraphStyle(
            "footnote",
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=DARK2,
            spaceBefore=1,
            spaceAfter=1,
        ),
        "footnote_bullet": ParagraphStyle(
            "footnote_bullet",
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=DARK2,
            leftIndent=14,
            bulletIndent=4,
            spaceBefore=1,
            spaceAfter=1,
        ),
    }


# ---------------------------------------------------------------------------
# Inline markdown → reportlab Paragraph XML
# ---------------------------------------------------------------------------

_INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))")


def inline_to_xml(text: str) -> str:
    """Escape, then convert bold/italic/code/links to reportlab <b>/<i>/<font>."""
    out: list[str] = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            out.append(f"<b>{html.escape(part[2:-2])}</b>")
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            out.append(f"<i>{html.escape(part[1:-1])}</i>")
        elif part.startswith("`") and part.endswith("`"):
            out.append(
                f'<font face="Courier" size="9">{html.escape(part[1:-1])}</font>'
            )
        elif part.startswith("[") and "](" in part:
            label, _ = part[1:-1].split("](", 1)
            out.append(html.escape(label))
        else:
            out.append(html.escape(part))
    return "".join(out)


# ---------------------------------------------------------------------------
# Block emitter
# ---------------------------------------------------------------------------

def emit_blocks(blocks: list[tuple], styles: dict, heading_base: int = 1) -> list:
    flow: list = []
    for kind, payload in blocks:
        if kind == "heading":
            level, text = payload
            shifted = min(3, level + heading_base - 1)
            style = styles[f"h{shifted}"] if shifted <= 3 else styles["h3"]
            flow.append(Paragraph(inline_to_xml(text), style))
        elif kind == "paragraph":
            flow.append(Paragraph(inline_to_xml(payload), styles["body"]))
        elif kind == "bullets":
            for item in payload:
                flow.append(
                    Paragraph(
                        inline_to_xml(item),
                        styles["bullet"],
                        bulletText="•",
                    )
                )
            flow.append(Spacer(1, 4))
        elif kind == "numbered":
            for idx, item in enumerate(payload, 1):
                flow.append(
                    Paragraph(
                        inline_to_xml(item),
                        styles["bullet"],
                        bulletText=f"{idx}.",
                    )
                )
            flow.append(Spacer(1, 4))
        elif kind == "table":
            flow.append(build_table(payload, styles))
            flow.append(Spacer(1, 6))
        elif kind == "hr":
            flow.append(Spacer(1, 6))
        elif kind == "pagebreak":
            flow.append(PageBreak())
    return flow


def build_table(payload, styles: dict) -> Table:
    header, rows = payload

    # Convert all cells to Paragraphs so inline markdown renders
    data: list[list] = [
        [Paragraph(inline_to_xml(h), styles["cell_header"]) for h in header]
    ]
    for row in rows:
        padded = row + [""] * (len(header) - len(row))
        data.append(
            [Paragraph(inline_to_xml(c), styles["cell"]) for c in padded[: len(header)]]
        )

    tbl = Table(data, hAlign="LEFT", repeatRows=1)
    ts = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
            ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#FFFFFF")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.25, HexColor("#D1D5DB")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]
    )
    # Alternating row shading
    for i in range(1, len(data)):
        if i % 2 == 0:
            ts.add("BACKGROUND", (0, i), (-1, i), PALE)
    tbl.setStyle(ts)
    return tbl


# ---------------------------------------------------------------------------
# Document assembly
# ---------------------------------------------------------------------------

def title_page(styles: dict) -> list:
    redaction_bullets = [
        "Identifiers replaced with placeholders: "
        "<font face='Courier' size='8'>[company]</font>, "
        "<font face='Courier' size='8'>[domain]</font>, "
        "<font face='Courier' size='8'>[hostname]</font>, "
        "<font face='Courier' size='8'>[customer]</font>, "
        "<font face='Courier' size='8'>[staff]</font>, "
        "<font face='Courier' size='8'>[system]</font>, "
        "<font face='Courier' size='8'>[address]</font>.",
        "Admin URL paths → "
        "<font face='Courier' size='8'>[dashboard-N]</font> "
        "(numbered 1–14). AJAX endpoint names → "
        "<font face='Courier' size='8'>[endpoint-N]</font>.",
        "Industry-specific product categories generalized to &quot;widgets.&quot;",
        "Live API keys and credentials cut entirely.",
        "Dollar amounts, counts, and scale figures swapped for fakes of the "
        "same order of magnitude. A &quot;~$180K past-due&quot; in this report "
        "corresponds to a real past-due of similar scale; exact figures are not "
        "preserved.",
        "Specific dates generalized to &quot;Early 2026.&quot;",
    ]

    flow: list = [
        Spacer(1, 1.4 * inch),
        Paragraph("SECURITY AUDIT REPORT", styles["title"]),
        Spacer(1, 0.18 * inch),
        Paragraph("[company] — redacted portfolio version", styles["subtitle"]),
        Spacer(1, 0.35 * inch),
        Paragraph("<b>Joshua Wetzel</b>", styles["subtitle_small"]),
        Paragraph("225-305-9321", styles["subtitle_small"]),
        Paragraph("josh@jawetzel.com", styles["subtitle_small"]),
        Spacer(1, 0.35 * inch),
        Paragraph("Non-Intrusive Public Information Review", styles["subtitle_small"]),
        Paragraph("Early 2026", styles["subtitle_small"]),
        Spacer(1, 1.2 * inch),
        Paragraph("Redaction notice", styles["footnote_head"]),
        Paragraph(
            "This is a redacted portfolio version of an original security audit "
            "deliverable. To protect the identity of the audited organization, "
            "the following redactions have been applied:",
            styles["footnote"],
        ),
    ]
    for b in redaction_bullets:
        flow.append(Paragraph(b, styles["footnote_bullet"], bulletText="•"))
    flow.append(
        Paragraph(
            "Every finding is real and was observed on the live site.",
            styles["footnote"],
        )
    )
    flow.append(PageBreak())
    return flow


def toc_page(styles: dict) -> list:
    items = [
        "1. Executive Summary",
        "2. Internal Pages Exposed — Detail",
        "3. Data Leaks — Detail",
        "4. What We Looked At",
    ]
    flow: list = [Paragraph("Table of Contents", styles["h1"]), Spacer(1, 8)]
    for item in items:
        flow.append(Paragraph(html.escape(item), styles["toc_item"]))
    flow.append(PageBreak())
    return flow


def section(filename: str, heading: str, styles: dict) -> list:
    md = (CONTENT_DIR / filename).read_text(encoding="utf-8")
    md = strip_docx_skip_blocks(md)
    md = strip_docx_skips(md)
    md = re.sub(r"^\s*#\s+.*\n", "", md, count=1)
    blocks = parse_blocks(md)
    return [
        Paragraph(html.escape(heading), styles["h1"]),
        Spacer(1, 6),
        *emit_blocks(blocks, styles, heading_base=2),
    ]


# ---------------------------------------------------------------------------
# Footer with page numbers
# ---------------------------------------------------------------------------

def _footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(FOOTER)
    text = (
        "Security Audit Report — redacted portfolio version  |  "
        f"Page {doc.page}"
    )
    canvas.drawCentredString(letter[0] / 2, 0.4 * inch, text)
    canvas.restoreState()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = _styles()

    doc = SimpleDocTemplate(
        str(OUTPUT_FILE),
        pagesize=letter,
        leftMargin=0.9 * inch,
        rightMargin=0.9 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="Security Audit Report — redacted portfolio version",
        author="Joshua Wetzel",
    )

    story: list = []
    story += title_page(styles)
    story += toc_page(styles)
    story += section("summary.md", "1. Executive Summary", styles)
    story.append(PageBreak())
    story += section("details-dashboards.md", "2. Internal Pages Exposed — Detail", styles)
    story.append(PageBreak())
    story += section("details-data-leaks.md", "3. Data Leaks — Detail", styles)
    story.append(PageBreak())
    story += section("scope.md", "4. What We Looked At", styles)

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    print(f"Saved: {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
