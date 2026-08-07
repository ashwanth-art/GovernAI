#!/usr/bin/env python3
"""
Build a styled .docx from one of the AI Governance markdown reports.

    python3 build/build-docx.py RAG-Governance-Backend-Flow.md

What it does beyond a plain `pandoc -o out.docx in.md`:

  * Rewrites `diagrams/NAME.svg` image links to `diagrams/png/NAME.png` and
    pins them to the text-column width. Word's SVG support is unreliable
    through Pandoc, and unsized images default to their pixel size, which
    overflows the page badly for a 2400px-wide figure.
  * Lifts the leading `# H1` into document metadata so it renders with the
    Title style instead of appearing as a body heading and again in the TOC.
  * Applies build/reference.docx for fonts, heading colours and table styling.

Deliberately NOT using --number-sections: the markdown already numbers its
own headings ("## 1. Architecture Overview"), so Pandoc numbering would
produce "1 1. Architecture Overview".
"""

import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "build" / "reference.docx"


def text_column_inches(reference: Path) -> float:
    """Read the usable text-column width out of the reference doc.

    Derived rather than hardcoded so that changing the page size in
    make-reference.py cannot silently leave figures the wrong width.
    """
    doc = zipfile.ZipFile(reference).read("word/document.xml").decode()
    pg = re.search(r'<w:pgSz\b[^>]*w:w="(\d+)"', doc)
    mar = re.search(r"<w:pgMar\b[^>]*>", doc)
    if not pg or not mar:
        sys.exit("reference.docx has no page geometry — rerun build/make-reference.py")
    left = int(re.search(r'w:left="(\d+)"', mar.group(0)).group(1))
    right = int(re.search(r'w:right="(\d+)"', mar.group(0)).group(1))
    return (int(pg.group(1)) - left - right) / 1440


def resolve_pandoc() -> str:
    p = shutil.which("pandoc") or str(Path.home() / "local/bin/pandoc")
    if not Path(p).exists():
        sys.exit("pandoc not found on PATH or at ~/local/bin/pandoc")
    return p


def rewrite_images(md: str, root: Path, width_in: float) -> tuple[str, list[str]]:
    """Point SVG figure links at the rendered PNGs and size them."""
    missing: list[str] = []

    def sub(m: re.Match) -> str:
        alt, path = m.group(1), m.group(2)
        png = re.sub(r"^diagrams/(.+)\.svg$", r"diagrams/png/\1.png", path)
        if not (root / png).exists():
            missing.append(png)
        return f"![{alt}]({png}){{width={width_in:.2f}in}}"

    md = re.sub(r"!\[([^\]]*)\]\((diagrams/[^)]+\.svg)\)", sub, md)
    return md, missing


def lift_title(md: str) -> tuple[str, str]:
    """Pull the leading '# Title' out of the body and return it separately."""
    m = re.match(r"\A\s*#\s+(.+?)\s*\n", md)
    if not m:
        return md, ""
    return md[m.end():], m.group(1).strip()


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {Path(sys.argv[0]).name} <markdown-file> [out.docx]")

    src = Path(sys.argv[1])
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        sys.exit(f"no such file: {src}")

    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".docx")
    if not out.is_absolute():
        out = ROOT / out

    if not REFERENCE.exists():
        sys.exit(f"missing {REFERENCE.relative_to(ROOT)} — run build/make-reference.py first")

    width_in = text_column_inches(REFERENCE)
    md = src.read_text(encoding="utf-8")
    md, missing = rewrite_images(md, ROOT, width_in)
    md, title = lift_title(md)

    if missing:
        print("WARNING: referenced PNGs do not exist:")
        for p in sorted(set(missing)):
            print(f"  - {p}")
        print("  (render them with diagrams/render.js first)")

    figures = len(re.findall(r"!\[[^\]]*\]\(", md))
    tables = len(re.findall(r"^\s*\|", md, re.M))
    print(f"source: {src.name}  title={title!r}  figures={figures}  table-rows={tables}")
    print(f"text column: {width_in:.2f}in (from reference.docx)")

    with tempfile.TemporaryDirectory() as td:
        staged = Path(td) / src.name
        staged.write_text(md, encoding="utf-8")

        cmd = [
            resolve_pandoc(),
            str(staged),
            "-o", str(out),
            "--from", "markdown+pipe_tables+link_attributes",
            "--reference-doc", str(REFERENCE),
            "--shift-heading-level-by=-1",
            "--toc",
            "--toc-depth=2",
            "--resource-path", str(ROOT),
            "--dpi=300",
        ]
        if title:
            cmd += ["--metadata", f"title={title}"]

        subprocess.run(cmd, check=True, cwd=ROOT)

    size = out.stat().st_size / 1024
    print(f"wrote {out.relative_to(ROOT)}  ({size:.0f}KB)")


if __name__ == "__main__":
    main()
