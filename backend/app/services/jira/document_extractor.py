import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO

from fastapi import HTTPException
from pypdf import PdfReader


MAX_BRD_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_BRD_ATTACHMENT_TEXT_CHARS = 120_000
MAX_BRD_PDF_PAGES = 50


def _limit_extracted_attachment_text(text: str) -> tuple[str, bool]:
    stripped = text.strip()
    if len(stripped) <= MAX_BRD_ATTACHMENT_TEXT_CHARS:
        return stripped, False
    return stripped[:MAX_BRD_ATTACHMENT_TEXT_CHARS].rstrip(), True


def decode_text_attachment(content: bytes, content_type: str, filename: str) -> tuple[str, bool]:
    if len(content) > MAX_BRD_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail="The selected attachment is too large for BRD extraction. Use a file up to 10 MB or paste the relevant text manually.",
        )

    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    normalized_name = filename.strip().lower()

    if (
        normalized_type.startswith("text/")
        or normalized_type in {
            "application/json",
            "application/xml",
            "application/yaml",
            "application/x-yaml",
            "text/markdown",
            "text/csv",
        }
        or normalized_name.endswith((".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"))
    ):
        for encoding in ("utf-8-sig", "utf-8", "utf-16"):
            try:
                return _limit_extracted_attachment_text(content.decode(encoding))
            except UnicodeDecodeError:
                continue
        return _limit_extracted_attachment_text(content.decode("utf-8", errors="replace"))

    is_docx = (
        normalized_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or normalized_name.endswith(".docx")
    )
    if is_docx:
        try:
            with zipfile.ZipFile(BytesIO(content)) as archive:
                document_xml = archive.read("word/document.xml")
        except (KeyError, zipfile.BadZipFile) as exc:
            raise HTTPException(status_code=400, detail="Could not read text from the DOCX attachment") from exc

        try:
            root = ET.fromstring(document_xml)
        except ET.ParseError as exc:
            raise HTTPException(status_code=400, detail="Could not parse DOCX document text") from exc

        namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        paragraphs: list[str] = []
        for paragraph in root.iter(f"{namespace}p"):
            parts: list[str] = []
            for node in paragraph.iter():
                if node.tag == f"{namespace}t" and node.text:
                    parts.append(node.text)
                elif node.tag == f"{namespace}tab":
                    parts.append("\t")
                elif node.tag == f"{namespace}br":
                    parts.append("\n")
            text = "".join(parts).strip()
            if text:
                paragraphs.append(text)
        return _limit_extracted_attachment_text("\n\n".join(paragraphs))

    is_pdf = normalized_type == "application/pdf" or normalized_name.endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(BytesIO(content))
            pages = []
            page_count = len(reader.pages)
            if page_count > MAX_BRD_PDF_PAGES:
                raise HTTPException(
                    status_code=413,
                    detail=f"The selected PDF has {page_count} pages. Use a PDF up to {MAX_BRD_PDF_PAGES} pages or paste the relevant BRD text manually.",
                )
            for index, page in enumerate(reader.pages, start=1):
                page_text = (page.extract_text() or "").strip()
                if page_text:
                    pages.append(f"Page {index}\n{page_text}")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read text from the PDF attachment") from exc

        text = "\n\n".join(pages).strip()
        if not text:
            raise HTTPException(
                status_code=400,
                detail="The selected PDF does not contain extractable text. Use an OCR/text PDF or paste the BRD text manually.",
            )
        return _limit_extracted_attachment_text(text)

    raise HTTPException(
        status_code=415,
        detail="This attachment type cannot be extracted as BRD text. Use TXT, MD, CSV, JSON, XML, YAML, LOG, DOCX, or text-based PDF.",
    )
