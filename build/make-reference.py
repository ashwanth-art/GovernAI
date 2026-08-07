#!/usr/bin/env python3
"""
Generate build/reference.docx — the style template Pandoc uses for the
AI Governance report deliverables.

Pandoc copies paragraph/character styles out of a "reference doc" and applies
them to its own output. Rather than hand-styling a .docx in Word and hoping it
stays consistent, we start from Pandoc's own default reference doc and patch
word/styles.xml so the result is reproducible and version-controllable.

Palette is deliberately the same as the SVG/D2 diagrams in diagrams/ so the
figures and the prose read as one document.

    python3 build/make-reference.py

Requires pandoc on PATH (or at ~/local/bin/pandoc).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "reference.docx"

# ---- palette (matches diagrams/) -------------------------------------------
INK = "1E293B"        # near-black slate — titles, H1
BLUE = "2563EB"       # primary accent — H2, rules
SLATE = "475569"      # muted — H3, captions
PURPLE = "7C3AED"     # tertiary — H4
GREY_BG = "F1F5F9"    # table header fill
BORDER = "CBD5E1"     # table borders

BODY_FONT = "Calibri"
HEAD_FONT = "Calibri"

# ---- page geometry ---------------------------------------------------------
# Pandoc's stock reference.docx defines NO page size and NO margins, which
# leaves the rendered page dependent on the reader's local Word defaults — not
# acceptable for a deliverable. Set them explicitly.
# Units are twips (1/1440 inch). A4 = 11906 x 16838; US Letter = 12240 x 15840.
# US Letter, matching the existing .docx deliverables in this folder.
# Switch to 11906 x 16838 for A4 if the audience is primarily EU/India.
PAGE_W, PAGE_H = 12240, 15840   # US Letter
MARGIN = 1440                   # 1 inch all round -> 6.50in text column

SECT_PR = (
    f'<w:pgSz w:w="{PAGE_W}" w:h="{PAGE_H}"/>'
    f'<w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" '
    f'w:left="{MARGIN}" w:header="720" w:footer="720" w:gutter="0"/>'
)


def fonts(name):
    return f'<w:rFonts w:ascii="{name}" w:hAnsi="{name}" w:cs="{name}"/>'


# styleId -> (pPr inner XML, rPr inner XML)
STYLES = {
    "Title": (
        '<w:spacing w:before="0" w:after="120"/><w:jc w:val="left"/>',
        f'{fonts(HEAD_FONT)}<w:b/><w:color w:val="{INK}"/><w:sz w:val="52"/><w:szCs w:val="52"/>',
    ),
    "Subtitle": (
        '<w:spacing w:before="0" w:after="360"/><w:jc w:val="left"/>',
        f'{fonts(HEAD_FONT)}<w:color w:val="{SLATE}"/><w:sz w:val="26"/><w:i/>',
    ),
    # H1 gets a blue rule under it — cheap way to make sections scannable.
    "Heading1": (
        f'<w:keepNext/><w:spacing w:before="440" w:after="160"/>'
        f'<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="{BLUE}"/></w:pBdr>',
        f'{fonts(HEAD_FONT)}<w:b/><w:color w:val="{INK}"/><w:sz w:val="34"/><w:szCs w:val="34"/>',
    ),
    "Heading2": (
        '<w:keepNext/><w:spacing w:before="320" w:after="120"/>',
        f'{fonts(HEAD_FONT)}<w:b/><w:color w:val="{BLUE}"/><w:sz w:val="26"/><w:szCs w:val="26"/>',
    ),
    "Heading3": (
        '<w:keepNext/><w:spacing w:before="240" w:after="100"/>',
        f'{fonts(HEAD_FONT)}<w:b/><w:color w:val="{SLATE}"/><w:sz w:val="23"/><w:szCs w:val="23"/>',
    ),
    "Heading4": (
        '<w:keepNext/><w:spacing w:before="200" w:after="80"/>',
        f'{fonts(HEAD_FONT)}<w:b/><w:i/><w:color w:val="{PURPLE}"/><w:sz w:val="21"/>',
    ),
    "BodyText": (
        '<w:spacing w:before="0" w:after="140" w:line="276" w:lineRule="auto"/>',
        f'{fonts(BODY_FONT)}<w:color w:val="1F2937"/><w:sz w:val="22"/>',
    ),
    "FirstParagraph": (
        '<w:spacing w:before="0" w:after="140" w:line="276" w:lineRule="auto"/>',
        f'{fonts(BODY_FONT)}<w:color w:val="1F2937"/><w:sz w:val="22"/>',
    ),
    # Compact is what Pandoc puts on every paragraph inside a *tight* list, and
    # these reports are overwhelmingly bullet lists — it ends up on ~75% of the
    # document. At 3pt after it reads as squished, so it gets close to full body
    # spacing, just slightly tighter to keep list items visually grouped.
    "Compact": (
        '<w:spacing w:before="0" w:after="100" w:line="276" w:lineRule="auto"/>',
        f'{fonts(BODY_FONT)}<w:color w:val="1F2937"/><w:sz w:val="22"/>',
    ),
    # Figure captions: Pandoc uses ImageCaption / CaptionedFigure for figures.
    # "Caption" alone is NOT what lands on them — styling only that one silently
    # does nothing, which is what left the text under each figure running together.
    "ImageCaption": (
        '<w:spacing w:before="140" w:after="360"/><w:jc w:val="center"/>',
        f'{fonts(BODY_FONT)}<w:i/><w:color w:val="{SLATE}"/><w:sz w:val="18"/>',
    ),
    "CaptionedFigure": (
        '<w:keepNext/><w:spacing w:before="280" w:after="0"/><w:jc w:val="center"/>',
        "",
    ),
    "Caption": (
        '<w:spacing w:before="140" w:after="320"/><w:jc w:val="center"/>',
        f'{fonts(BODY_FONT)}<w:i/><w:color w:val="{SLATE}"/><w:sz w:val="18"/>',
    ),
    "TableCaption": (
        '<w:spacing w:before="140" w:after="240"/><w:jc w:val="center"/>',
        f'{fonts(BODY_FONT)}<w:i/><w:color w:val="{SLATE}"/><w:sz w:val="18"/>',
    ),
    # Normal is the fallback for anything Pandoc emits without an explicit style
    # (15 paragraphs here). Pandoc's stock Normal defines no spacing at all.
    "Normal": (
        '<w:spacing w:before="0" w:after="140" w:line="276" w:lineRule="auto"/>',
        f'{fonts(BODY_FONT)}<w:color w:val="1F2937"/><w:sz w:val="22"/>',
    ),
    "TOCHeading": (
        '<w:keepNext/><w:spacing w:before="0" w:after="200"/>',
        f'{fonts(HEAD_FONT)}<w:b/><w:color w:val="{INK}"/><w:sz w:val="32"/>',
    ),
    # Pull-quote / callout — the report opens with a blockquote header block.
    "BlockText": (
        f'<w:spacing w:before="160" w:after="240"/><w:ind w:left="340"/>'
        f'<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="{BLUE}"/></w:pBdr>',
        f'{fonts(BODY_FONT)}<w:color w:val="{SLATE}"/><w:sz w:val="21"/><w:i/>',
    ),
}

# Styles Pandoc emits but its stock reference doc does not define. Without these
# the 12 code blocks in these reports fall back to Pandoc's own bare default.
INSERT_STYLES = f"""<w:style w:type="paragraph" w:styleId="SourceCode">
  <w:name w:val="Source Code"/>
  <w:basedOn w:val="Normal"/>
  <w:qFormat/>
  <w:pPr>
    <w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>
    <w:ind w:left="170" w:right="170"/>
    <w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>
    <w:pBdr>
      <w:left w:val="single" w:sz="18" w:space="8" w:color="{BLUE}"/>
    </w:pBdr>
    <w:contextualSpacing/>
  </w:pPr>
  <w:rPr>
    <w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/>
    <w:color w:val="0F172A"/><w:sz w:val="17"/><w:szCs w:val="17"/>
  </w:rPr>
</w:style>"""

# Table style: light borders + shaded header row, sized down slightly so wide
# governance tables (6 columns of control IDs) still fit the text column.
TABLE_STYLE = f"""<w:style w:type="table" w:default="1" w:styleId="Table">
  <w:name w:val="Table"/>
  <w:basedOn w:val="TableNormal"/>
  <w:tblPr>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="{BORDER}"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="{BORDER}"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="{BORDER}"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="{BORDER}"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="{BORDER}"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="{BORDER}"/>
    </w:tblBorders>
    <w:tblCellMar>
      <w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>
      <w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/>
    </w:tblCellMar>
  </w:tblPr>
  <w:rPr>{fonts(BODY_FONT)}<w:sz w:val="19"/></w:rPr>
  <w:tblStylePr w:type="firstRow">
    <w:rPr><w:b/><w:color w:val="{INK}"/></w:rPr>
    <w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="{GREY_BG}"/></w:tcPr>
  </w:tblStylePr>
</w:style>"""


def patch_style(xml: str, style_id: str, ppr: str, rpr: str) -> str:
    """Replace (or insert) the pPr/rPr of one w:style block."""
    pattern = re.compile(
        r'(<w:style\b[^>]*w:styleId="' + re.escape(style_id) + r'"[^>]*>)(.*?)(</w:style>)',
        re.S,
    )
    m = pattern.search(xml)
    if not m:
        print(f"  ! style {style_id} not found — skipped")
        return xml

    head, body, tail = m.groups()
    body = re.sub(r"<w:pPr>.*?</w:pPr>", "", body, flags=re.S)
    body = re.sub(r"<w:rPr>.*?</w:rPr>", "", body, flags=re.S)
    body = body.rstrip()
    if ppr:
        body += f"<w:pPr>{ppr}</w:pPr>"
    if rpr:
        body += f"<w:rPr>{rpr}</w:rPr>"
    return xml[: m.start()] + head + body + tail + xml[m.end():]


def main():
    pandoc = shutil.which("pandoc") or str(Path.home() / "local/bin/pandoc")
    if not Path(pandoc).exists():
        sys.exit("pandoc not found on PATH or at ~/local/bin/pandoc")

    OUT.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        base = td / "base.docx"
        subprocess.run(
            [pandoc, "-o", str(base), "--print-default-data-file", "reference.docx"],
            check=True,
        )

        work = td / "x"
        work.mkdir()
        with zipfile.ZipFile(base) as z:
            names = z.namelist()
            z.extractall(work)

        sp = work / "word" / "styles.xml"
        xml = sp.read_text(encoding="utf-8")

        print(f"patching {len(STYLES)} paragraph styles + table style")
        for sid, (ppr, rpr) in STYLES.items():
            xml = patch_style(xml, sid, ppr, rpr)

        # Default font for anything we did not name explicitly.
        xml = re.sub(
            r"(<w:docDefaults>.*?<w:rPr>)",
            r"\1" + fonts(BODY_FONT) + '<w:sz w:val="22"/>',
            xml,
            count=1,
            flags=re.S,
        )

        # Replace the stock Table style with ours. The attribute order in the
        # stock file is `w:type w:default w:styleId`, so match on styleId alone
        # rather than a fixed attribute sequence — getting this wrong appends a
        # duplicate styleId, which is malformed OOXML.
        table_re = re.compile(
            r'<w:style\b[^>]*w:styleId="Table"[^>]*>.*?</w:style>', re.S
        )
        if table_re.search(xml):
            xml, n = table_re.subn(TABLE_STYLE, xml, count=1)
            print(f"  replaced stock Table style ({n} match)")
        else:
            xml = xml.replace("</w:styles>", TABLE_STYLE + "</w:styles>")
            print("  inserted new Table style")

        dupes = xml.count('w:styleId="Table"')
        if dupes != 1:
            sys.exit(f"styles.xml has {dupes} Table styles — expected exactly 1")

        # Add styles Pandoc uses but the stock reference doc omits.
        for sid, block in [("SourceCode", INSERT_STYLES)]:
            if f'w:styleId="{sid}"' in xml:
                print(f"  {sid} already defined — left as is")
            else:
                xml = xml.replace("</w:styles>", block + "</w:styles>")
                print(f"  added missing {sid} style")

        sp.write_text(xml, encoding="utf-8")

        # Stamp explicit page size + margins into the reference doc's sectPr.
        dp = work / "word" / "document.xml"
        doc = dp.read_text(encoding="utf-8")
        if "<w:pgSz" in doc:
            print("  page geometry already present — left as is")
        else:
            doc, n = re.subn(r"(<w:sectPr[^>]*>)", r"\1" + SECT_PR, doc, count=1)
            if n != 1:
                sys.exit("could not find <w:sectPr> to stamp page geometry into")
            dp.write_text(doc, encoding="utf-8")
            col = (PAGE_W - 2 * MARGIN) / 1440
            print(f"  page {PAGE_W/1440:.2f}x{PAGE_H/1440:.2f}in, "
                  f"margins {MARGIN/1440:.2f}in -> text column {col:.2f}in")

        # Repack preserving the original entry order.
        if OUT.exists():
            OUT.unlink()
        with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
            for n in names:
                z.write(work / n, n)

    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f}KB)")


if __name__ == "__main__":
    main()
