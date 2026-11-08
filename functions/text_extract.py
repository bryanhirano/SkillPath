"""Turn an uploaded resume (PDF, DOCX or plain text) into plain text."""
from __future__ import annotations

import io
import re

MAX_BYTES = 5 * 1024 * 1024       # matches storage.rules
MAX_CHARS = 30_000                # bounds model latency and memory per request

SUPPORTED_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
}


class UnsupportedFileError(ValueError):
    pass


def detect_kind(filename: str, content_type: str | None) -> str:
    if content_type in SUPPORTED_TYPES:
        return SUPPORTED_TYPES[content_type]
    lower = filename.lower()
    for ext in ("pdf", "docx", "txt"):
        if lower.endswith("." + ext):
            return ext
    raise UnsupportedFileError("Upload a PDF, Word (.docx) or plain-text resume.")


def extract_text(data: bytes, filename: str, content_type: str | None = None) -> str:
    if len(data) > MAX_BYTES:
        raise UnsupportedFileError("Resume files must be 5 MB or smaller.")
    kind = detect_kind(filename, content_type)
    if kind == "pdf":
        text = _pdf_text(data)
    elif kind == "docx":
        text = _docx_text(data)
    else:
        text = data.decode("utf-8", errors="replace")
    return clean_text(text)


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()[:MAX_CHARS]


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(page.extract_text() or "") for page in reader.pages[:15]]
    text = "\n".join(pages)
    if not text.strip():
        raise UnsupportedFileError(
            "This PDF has no selectable text (it may be a scan). Upload a text-based PDF or paste your resume."
        )
    return text


def _docx_text(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(parts)
