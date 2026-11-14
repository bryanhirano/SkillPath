"""Authenticated Cloud Functions for resume text extraction."""

import io
import logging
import re
import zipfile

from docx import Document
from firebase_admin import db, initialize_app, storage
from firebase_functions import https_fn
from firebase_functions.options import set_global_options
from google.api_core.exceptions import NotFound
from pypdf import PdfReader

from skillpath.catalog import load_catalog
from skillpath.extraction import extract_skills, get_default_tagger
from skillpath.text_extract import clean_text

PROJECT_ID = "mynotes-ae8c6"
DATABASE_URL = "https://mynotes-ae8c6-default-rtdb.firebaseio.com"
STORAGE_BUCKET = "mynotes-ae8c6.firebasestorage.app"
RESUME_FOLDER = "resume"
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

# Imported after initialize_app() so these handlers share the configured app.
from target_job import list_target_roles, select_target_role  # noqa: E402,F401


def _resume_path(uid):
    """Return the Storage path of a user's resume.

    Resumes are stored as a single object named after the user's UID,
    e.g. ``resume/yhC97aSmzhOHom9yyECqUkcXrGD2`` (no extension, no subfolder).
    The path is built from the authenticated UID rather than read from the
    database, so a caller can never point the function at another user's file.

    Args:
        uid: Firebase Authentication UID of the resume owner.

    Returns:
        The object path inside the configured bucket.
    """
    return f"{RESUME_FOLDER}/{uid}"


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
        page_count = len(reader.pages)
    except Exception as error:
        raise ValueError("The PDF could not be read.") from error

    if page_count > MAX_PDF_PAGES:
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


def _is_docx(file_bytes):
    """Return whether the bytes are a ZIP archive containing a Word document."""
    if not file_bytes.startswith(b"PK"):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            return "word/document.xml" in archive.namelist()
    except zipfile.BadZipFile:
        return False


def _download_resume(file_path):
    """Download a resume from Firebase Storage if it is below the size limit.

    Args:
        file_path: The path of the resume object in the configured bucket.

    Returns:
        The downloaded resume contents.

    Raises:
        NotFound: If no object exists at the path.
        ValueError: If the object's size is unavailable or reaches the limit.
    """
    bucket = storage.bucket(STORAGE_BUCKET)
    blob = bucket.blob(file_path)
    blob.reload()

    if blob.size is None or blob.size >= MAX_FILE_SIZE:
        raise ValueError("Resume must be smaller than the 5 MB limit.")

    file_bytes = blob.download_as_bytes(if_generation_match=blob.generation)
    if len(file_bytes) >= MAX_FILE_SIZE:
        raise ValueError("Resume must be smaller than the 5 MB limit.")
    return file_bytes


def _extract_document_text(file_bytes):
    """Detect PDF or DOCX from the file contents and extract its text.

    The stored object has no file extension and its metadata may not carry a
    reliable content type, so the format is identified from the file's own
    signature instead.

    Args:
        file_bytes: The uploaded document contents.

    Returns:
        A tuple of the detected extension ("pdf" or "docx") and the extracted,
        trimmed document text.

    Raises:
        ValueError: If the format, contents, or text length is invalid.
    """
    if file_bytes.startswith(b"%PDF-"):
        file_type = "pdf"
        text = _extract_pdf_text(file_bytes)
    elif _is_docx(file_bytes):
        file_type = "docx"
        text = _extract_docx_text(file_bytes)
    else:
        raise ValueError("Only PDF and DOCX resumes are supported.")

    text = text.strip()
    if len(text) > MAX_TEXT_LENGTH:
        raise ValueError("Extracted resume text exceeds the 100,000 character limit.")
    return file_type, text


def _load_typed_resume(uid):
    """Return the user's typed resume text, or None if they have not typed one.

    The web app clears ``users/<uid>/resumeText`` whenever a file is uploaded,
    so a typed resume here is always newer than any uploaded file.
    """
    typed_text = db.reference(f"users/{uid}/resumeText").get()
    if not isinstance(typed_text, str) or not typed_text.strip():
        return None
    typed_text = typed_text.strip()
    if len(typed_text) > MAX_TEXT_LENGTH:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Resume text exceeds the 100,000 character limit.",
        )
    return typed_text


def _load_resume_text(uid):
    """Load the authenticated user's resume: typed text, else the uploaded file.

    Args:
        uid: Firebase Authentication UID of the resume owner.

    Returns:
        A tuple containing a display file name and the extracted text.

    Raises:
        https_fn.HttpsError: If the file is missing, invalid, or its contents
            cannot be extracted.
    """
    typed_text = _load_typed_resume(uid)
    if typed_text:
        return "Typed resume", typed_text

    file_path = _resume_path(uid)

    try:
        file_bytes = _download_resume(file_path)
        file_type, extracted_text = _extract_document_text(file_bytes)
    except NotFound as error:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message="No uploaded resume was found.",
        ) from error
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

    return f"resume.{file_type}", extracted_text


@https_fn.on_call()
def extract_resume_text(request: https_fn.CallableRequest):
    """Return extracted text from the authenticated caller's uploaded resume.

    Args:
        request: The Firebase callable request, including authentication data.

    Returns:
        A mapping with success status, file name, extracted text, and
        character count.

    Raises:
        https_fn.HttpsError: If the caller is unauthenticated or the resume
            file or extracted text is invalid.
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
def identify_resume_skills(request: https_fn.CallableRequest):
    """Identify skills in the caller's resume using the SkillPath engine.

    The resume text is cleaned and capped by ``skillpath.text_extract`` and
    then matched against the skill catalog in ``skillpath/data``. If the BERT
    tagger is installed and enabled (``SKILLPATH_NER``), it adds skills the
    catalog aliases miss; otherwise the taxonomy matcher runs alone.

    Args:
        request: The Firebase callable request, including authentication data.

    Returns:
        A mapping with success status and the identified skills, each with
        ``skillId``, ``name``, ``category``, estimated ``level`` (1-5) and
        ``confidence``.

    Raises:
        https_fn.HttpsError: If the caller is unauthenticated, the resume is
            missing or invalid, or skill extraction fails.
    """
    if request.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Please sign in first.",
        )

    _, resume_text = _load_resume_text(request.auth.uid)

    try:
        result = extract_skills(
            clean_text(resume_text),
            load_catalog(),
            get_default_tagger(),
        )
    except Exception as error:
        logging.exception("Skill extraction failed.")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Skill identification failed.",
        ) from error

    return {
        "status": "success",
        "skills": result["skills"],
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
            file or extracted text is invalid. """
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
