"""Build a minimal .docx from plain text (one paragraph per line)."""

from __future__ import annotations

from io import BytesIO

from docx import Document
from docx.shared import Pt


def text_to_docx_bytes(text: str, *, max_chars: int = 450_000) -> bytes:
    if len(text) > max_chars:
        raise ValueError(f"文本过长（上限约 {max_chars // 1000} 千字），请缩短后再导出。")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    doc = Document()
    try:
        style = doc.styles["Normal"]
        style.font.size = Pt(11)
        style.font.name = "Calibri"
    except Exception:
        pass
    for line in normalized.split("\n"):
        doc.add_paragraph(line)
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()
