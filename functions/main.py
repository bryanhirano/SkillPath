"""Authenticated Cloud Functions for resume text extraction."""

import io
import logging
import re

from docx import Document
from firebase_admin import db, initialize_app, storage
from firebase_functions import https_fn
from firebase_functions.options import set_global_options
from pypdf import PdfReader

PROJECT_ID = "mynotes-ae8c6"
DATABASE_URL = "https://mynotes-ae8c6-default-rtdb.firebaseio.com"
STORAGE_BUCKET = "mynotes-ae8c6.firebasestorage.app"
MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_TEXT_LENGTH = 100000
MAX_PDF_PAGES = 50

set_global_options(max_instances=10)
initialize_app(
    options={
        "projectId": PROJECT_ID,
        "databaseURL": DATABASE_URL,
        "storageBucket": STORAGE_BUCKET,
    }
)


def _extract_pdf_text(file_bytes):
    """Extract text from a PDF, enforcing the configured page limit.

    Args:
        file_bytes: The PDF file contents.

    Returns:
        Text from non-empty pages, joined with newline separators.

    Raises:
        ValueError: If the PDF cannot be read or exceeds the page limit.
    """
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
    except Exception as error:
        raise ValueError("The PDF could not be read.") from error

    if len(reader.pages) > MAX_PDF_PAGES:
        raise ValueError("PDF exceeds the 50-page limit.")

    paragraphs = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            paragraphs.append(page_text)
    return "\n".join(paragraphs)


def _extract_docx_text(file_bytes):
    """Extract paragraph and table text from a DOCX document.

    Args:
        file_bytes: The DOCX file contents.

    Returns:
        Non-empty paragraph and table-cell text, joined by newlines.

    Raises:
        ValueError: If the contents cannot be read as a DOCX document.
    """
    try:
        document = Document(io.BytesIO(file_bytes))
    except Exception as error:
        raise ValueError("The DOCX file could not be read.") from error

    paragraphs = [
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    ]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip():
                    paragraphs.append(cell.text)
    return "\n".join(paragraphs)


def _download_resume(file_path):
    """Download a resume from Firebase Storage if it is below the size limit.

    Args:
        file_path: The path of the resume object in the configured bucket.

    Returns:
        The downloaded resume contents.

    Raises:
        ValueError: If the object's size is unavailable or reaches the limit.
    """
    bucket = storage.bucket(STORAGE_BUCKET)
    blob = bucket.blob(file_path)
    blob.reload()

    if blob.size is None or blob.size >= MAX_FILE_SIZE:
        raise ValueError("Resume must be smaller than the 5 MB limit.")

    file_bytes = blob.download_as_bytes()
    if len(file_bytes) >= MAX_FILE_SIZE:
        raise ValueError("Resume must be smaller than the 5 MB limit.")
    return file_bytes


def _extract_document_text(file_bytes, file_name, content_type):
    """Validate a PDF or DOCX and extract text within the configured limit.

    Args:
        file_bytes: The uploaded document contents.
        file_name: The original name used to determine the document format.
        content_type: The document's declared MIME type.

    Returns:
        Extracted, trimmed document text.

    Raises:
        ValueError: If the format, signature, contents, or text length is invalid.
    """
    file_name = file_name.lower()
    if file_name.endswith(".pdf") and content_type == "application/pdf":
        if not file_bytes.startswith(b"%PDF-"):
            raise ValueError("The file is not a valid PDF.")
        text = _extract_pdf_text(file_bytes)
    elif (
        file_name.endswith(".docx")
        and content_type
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        if not file_bytes.startswith(b"PK"):
            raise ValueError("The file is not a valid DOCX.")
        text = _extract_docx_text(file_bytes)
    else:
        raise ValueError("Only PDF and DOCX resumes are supported.")

    text = text.strip()
    if len(text) > MAX_TEXT_LENGTH:
        raise ValueError("Extracted resume text exceeds the 100,000 character limit.")
    return text


def _load_resume_text(uid):
    """Load and extract the authenticated user's uploaded resume.

    Args:
        uid: Firebase Authentication UID of the resume owner.

    Returns:
        A tuple containing the original file name and extracted text.

    Raises:
        https_fn.HttpsError: If metadata is missing or invalid, the file is
            unavailable, or its contents cannot be extracted.
    """
    try:
        user_data = db.reference(f"users/{uid}").get() or {}
    except Exception as error:
        logging.exception("Failed to retrieve resume metadata.")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Unable to retrieve resume metadata.",
        ) from error

    if not isinstance(user_data, dict):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message="No valid resume record found.",
        )

    file_path = user_data.get("resumePath")
    file_name = user_data.get("resumeFileName")
    content_type = user_data.get("resumeContentType")
    if not all(
        isinstance(value, str) and value
        for value in (file_path, file_name, content_type)
    ):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message="No uploaded resume was found.",
        )

    allowed_prefix = f"resumes/{uid}/"
    stored_file_name = file_path[len(allowed_prefix) :]
    if (
        not file_path.startswith(allowed_prefix)
        or not stored_file_name
        or "/" in stored_file_name
    ):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message="Invalid resume storage path.",
        )

    try:
        file_bytes = _download_resume(file_path)
        extracted_text = _extract_document_text(
            file_bytes,
            file_name,
            content_type,
        )
    except ValueError as error:
        logging.warning("Resume validation failed: %s", error)
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(error),
        ) from error
    except Exception as error:
        logging.exception("Resume extraction failed.")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Resume extraction failed.",
        ) from error

    if not extracted_text:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="The resume contains no extractable text.",
        )

    return file_name, extracted_text


@https_fn.on_call()
def extract_resume_text(request: https_fn.CallableRequest):
    """Return extracted text from the authenticated caller's uploaded resume.

    Args:
        request: The Firebase callable request, including authentication data.

    Returns:
        A mapping with success status, original file name, extracted text, and
        character count.

    Raises:
        https_fn.HttpsError: If the caller is unauthenticated or the resume
            metadata, file, or extracted text is invalid.
    """
    if request.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Please sign in first.",
        )

    file_name, extracted_text = _load_resume_text(request.auth.uid)
    return {
        "status": "success",
        "fileName": file_name,
        "text": extracted_text,
        "characterCount": len(extracted_text),
    }


@https_fn.on_call()
def analyze_resume(request: https_fn.CallableRequest):
    """Identify resume skills, education, experience, and occupations.

    Analysis uses a rule-based keyword catalog and is intended as a
    preliminary aid, not an AI-generated career recommendation.

    Args:
        request: The Firebase callable request, including authentication data.

    Returns:
        A mapping with the file name, identified skills, education, years of
        experience, possible occupations, and skill count.

    Raises:
        https_fn.HttpsError: If the caller is unauthenticated or the resume
            metadata, file, or extracted text is invalid.
    """
    if request.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Please sign in first.",
        )

    file_name, resume_text = _load_resume_text(request.auth.uid)
    skills_catalog = {
        "Bookkeeping": ["bookkeeping", "bookkeeper"],
        "Accounting": ["accounting"],
        "QuickBooks": ["quickbooks"],
        "Microsoft 365": ["microsoft 365", "office 365"],
        "Microsoft Excel": ["excel", "spreadsheets"],
        "Financial Analysis": ["financial analysis", "financial data analysis"],
        "Data Entry": ["data entry"],
        "Administrative Support": [
            "administrative assistant",
            "administrative skills",
        ],
        "Payroll": ["payroll"],
        "Budgeting": ["budgeting", "budget management"],
        "Project Management": ["project management"],
        "Customer Service": ["customer service"],
        "Python": ["python"],
        "JavaScript": ["javascript"],
        "SQL": ["sql"],
        "Cybersecurity": ["cybersecurity", "cyber security"],
        "Data Analysis": ["data analysis", "data analytics"],
        "Leadership": ["leadership"],
        "Training": ["trained", "training"],
        "Communication": ["communication"],
        "Spanish": ["spanish"],
    }

    def contains_keyword(keyword):
        """Return whether a case-insensitive whole-word match exists."""
        return re.search(
            r"(?<!\w)" + re.escape(keyword) + r"(?!\w)",
            resume_text,
            flags=re.IGNORECASE,
        )

    identified_skills = [
        skill
        for skill, keywords in skills_catalog.items()
        if any(contains_keyword(keyword) for keyword in keywords)
    ]

    education_patterns = {
        "Doctorate": r"\b(ph\.?d\.?|doctorate|doctoral degree)\b",
        "Master's Degree": r"\b(m\.?b\.?a\.?|master'?s|m\.?s\.?|m\.?a\.?)\b",
        "Bachelor's Degree": r"\b(b\.?s\.?|b\.?a\.?|bachelor'?s)\b",
        "Associate Degree": r"\b(a\.?s\.?|a\.?a\.?|associate'?s)\b",
    }
    education = [
        degree
        for degree, pattern in education_patterns.items()
        if re.search(pattern, resume_text, re.IGNORECASE)
    ]

    experience_match = re.search(
        r"\b(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?experience\b",
        resume_text,
        re.IGNORECASE,
    )
    years_experience = (
        int(experience_match.group(1)) if experience_match else None
    )

    occupation_keywords = {
        "Bookkeeper": ["bookkeeper", "bookkeeping"],
        "Accountant": ["accountant"],
        "Administrative Assistant": ["administrative assistant"],
        "Financial Analyst": ["financial analyst"],
        "Software Developer": ["software developer"],
        "Project Manager": ["project manager"],
        "Data Analyst": ["data analyst"],
        "Cybersecurity Analyst": ["cybersecurity analyst"],
    }
    possible_occupations = [
        occupation
        for occupation, keywords in occupation_keywords.items()
        if any(contains_keyword(keyword) for keyword in keywords)
    ]

    return {
        "status": "success",
        "analysisType": "rule-based",
        "fileName": file_name,
        "skills": identified_skills,
        "education": education,
        "yearsExperience": years_experience,
        "possibleOccupations": possible_occupations,
        "skillsCount": len(identified_skills),
    }
