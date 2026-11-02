
import io
import os
import logging

from firebase_functions import https_fn
from firebase_functions.options import set_global_options

from firebase_admin import (
    initialize_app,
    db,
    storage
)

from pypdf import PdfReader
from docx import Document


# ==========================================
# FIREBASE CONFIGURATION
# ==========================================

PROJECT_ID = "mynotes-ae8c6"

DATABASE_NAME = (
    "mynotes-ae8c6-default-rtdb"
)

STORAGE_BUCKET = (
    "mynotes-ae8c6.firebasestorage.app"
)

MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_TEXT_LENGTH = 100000

set_global_options(max_instances=10)

initialize_app(options={
    "projectId": PROJECT_ID,
    "databaseURL": (
        f"https://{DATABASE_NAME}.firebaseio.com"
    ),
    "storageBucket": STORAGE_BUCKET
})


# ==========================================
# FUNCTION 1: HEALTH CHECK
# ==========================================

@https_fn.on_request()
def health_check(req: https_fn.Request):

    return https_fn.Response(
        '{"status": "ok", "service": "SkillPath AI"}',
        status=200,
        headers={
            "Content-Type": "application/json"
        }
    )


# ==========================================
# FUNCTION 2: BACKEND CONNECTION TEST
# ==========================================

@https_fn.on_call()
def test_connection(req: https_fn.CallableRequest):

    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Please log in first."
        )

    return {
        "status": "connected",
        "service": "SkillPath AI",
        "message": (
            "React successfully connected to Python!"
        )
    }


# ==========================================
# HELPER: VERIFY LOCAL EMULATORS
# ==========================================

def verify_local_emulators():

    database_host = os.environ.get(
        "FIREBASE_DATABASE_EMULATOR_HOST", ""
    )

    storage_host = os.environ.get(
        "FIREBASE_STORAGE_EMULATOR_HOST", ""
    )

    allowed_database_hosts = {
        "127.0.0.1:9000",
        "localhost:9000"
    }

    allowed_storage_hosts = {
        "127.0.0.1:9199",
        "localhost:9199"
    }

    if (
        database_host not in allowed_database_hosts
        or storage_host not in allowed_storage_hosts
    ):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message=(
                "Both local Database and Storage "
                "emulators must be running."
            )
        )


# ==========================================
# HELPER: DOWNLOAD RESUME FROM STORAGE
# ==========================================

def download_resume(file_path):

    verify_local_emulators()

    logging.info(
        "Retrieving resume from local Storage emulator."
    )

    # Firebase Admin SDK accesses the private
    # resume without granting client read access.
    bucket = storage.bucket(
        name=STORAGE_BUCKET
    )

    blob = bucket.blob(file_path)

    # Limit the downloaded file size.
    file_bytes = blob.download_as_bytes(
        start=0,
        end=MAX_FILE_SIZE
    )

    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError(
            "Resume exceeds the 5 MB limit."
        )

    logging.info(
        "Resume downloaded successfully."
    )

    return file_bytes


# ==========================================
# HELPER: EXTRACT PDF TEXT
# ==========================================

def extract_pdf_text(file_bytes):

    reader = PdfReader(
        io.BytesIO(file_bytes)
    )

    if len(reader.pages) > 50:
        raise ValueError(
            "PDF exceeds the 50-page limit."
        )

    paragraphs = []

    for page in reader.pages:
        page_text = page.extract_text() or ""

        if page_text.strip():
            paragraphs.append(page_text)

    return "\n".join(paragraphs)


# ==========================================
# HELPER: EXTRACT DOCX TEXT
# ==========================================

def extract_docx_text(file_bytes):

    document = Document(
        io.BytesIO(file_bytes)
    )

    paragraphs = []

    # Extract standard paragraphs.
    for paragraph in document.paragraphs:
        if paragraph.text.strip():
            paragraphs.append(
                paragraph.text
            )

    # Extract text contained in tables.
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip():
                    paragraphs.append(
                        cell.text
                    )

    return "\n".join(paragraphs)


# ==========================================
# HELPER: DETERMINE FILE TYPE
# ==========================================

def extract_document_text(
    file_bytes,
    file_name,
    content_type
):

    filename = file_name.lower()

    pdf_type = "application/pdf"

    docx_type = (
        "application/vnd.openxmlformats-officedocument."
        "wordprocessingml.document"
    )

    if (
        filename.endswith(".pdf")
        and content_type == pdf_type
    ):

        if not file_bytes.startswith(b"%PDF-"):
            raise ValueError(
                "The file is not a valid PDF."
            )

        text = extract_pdf_text(
            file_bytes
        )

    elif (
        filename.endswith(".docx")
        and content_type == docx_type
    ):

        if not file_bytes.startswith(b"PK"):
            raise ValueError(
                "The file is not a valid DOCX."
            )

        text = extract_docx_text(
            file_bytes
        )

    else:
        raise ValueError(
            "Only PDF and DOCX resumes are supported."
        )

    text = text.strip()

    if len(text) > MAX_TEXT_LENGTH:
        raise ValueError(
            "Extracted resume text exceeds the limit."
        )

    return text


# ==========================================
# FUNCTION 3: EXTRACT RESUME TEXT
# ==========================================

@https_fn.on_call()
def extract_resume_text(
    req: https_fn.CallableRequest
):

    # Step 1: Verify authentication.
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Please sign in first."
        )

    uid = req.auth.uid

    logging.info(
        "Starting authenticated resume extraction."
    )

    # Step 2: Verify local emulator environment.
    verify_local_emulators()

    # Step 3: Retrieve resume metadata.
    try:
        user_data = db.reference(
            f"users/{uid}"
        ).get() or {}

    except Exception:
        logging.exception(
            "Failed to retrieve resume metadata."
        )

        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=(
                "Unable to retrieve resume metadata."
            )
        )

    if not isinstance(user_data, dict):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message="No valid resume record found."
        )

    file_path = user_data.get(
        "resumePath"
    )

    file_name = user_data.get(
        "resumeFileName"
    )

    content_type = user_data.get(
        "resumeContentType"
    )

    # Step 4: Validate metadata.
    if not all(
        isinstance(value, str) and value
        for value in (
            file_path,
            file_name,
            content_type
        )
    ):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message=(
                "No uploaded resume metadata found."
            )
        )

    # Ensure that the stored path belongs
    # to the authenticated user.
    allowed_prefix = f"resumes/{uid}/"

    if (
        not file_path.startswith(allowed_prefix)
        or len(file_path) <= len(allowed_prefix)
    ):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message="Invalid resume storage path."
        )

    # Step 5: Download and extract.
    try:
        file_bytes = download_resume(
            file_path
        )

        extracted_text = extract_document_text(
            file_bytes,
            file_name,
            content_type
        )

    except ValueError as error:
        logging.warning(
            "Resume validation failed: %s",
            str(error)
        )

        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(error)
        )

    except Exception:
        # Log the underlying Python error in the
        # emulator terminal, not in the browser.
        logging.exception(
            "Resume extraction failed."
        )

        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Resume extraction failed."
        )

    # Step 6: Check extracted contents.
    if not extracted_text:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message=(
                "The resume contains no extractable text."
            )
        )

    logging.info(
        "Resume text extraction completed."
    )

    # Step 7: Return results to React.
    # Never log private resume contents.
    return {
        "status": "success",
        "fileName": file_name,
        "text": extracted_text,
        "characterCount": len(extracted_text)
    }

# ==========================================
# FUNCTION 4: STRUCTURED RESUME ANALYSIS
# ==========================================

@https_fn.on_call()
def analyze_resume(req: https_fn.CallableRequest):
    import re

    # Require an authenticated user.
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Please sign in first."
        )

    # Only process data in the local emulators.
    verify_local_emulators()

    uid = req.auth.uid

    # Retrieve the authenticated user's resume metadata.
    try:
        user_data = db.reference(
            f"users/{uid}"
        ).get() or {}
    except Exception:
        logging.exception("Resume metadata lookup failed.")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Unable to retrieve resume metadata."
        )

    if not isinstance(user_data, dict):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message="Resume record not found."
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
            message="Upload a resume before analyzing it."
        )

    # Prevent access to another user's files.
    allowed_prefix = f"resumes/{uid}/"

    if not file_path.startswith(allowed_prefix):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message="Invalid resume path."
        )

    # Download and extract text using existing helpers.
    try:
        file_bytes = download_resume(file_path)

        resume_text = extract_document_text(
            file_bytes,
            file_name,
            content_type
        )

    except ValueError as error:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(error)
        )

    except Exception:
        logging.exception("Resume analysis preparation failed.")
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Unable to process the resume."
        )

    if not resume_text:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="No readable resume text found."
        )

    # ------------------------------------------
    # RULE-BASED SKILL IDENTIFICATION
    # ------------------------------------------

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
            "administrative skills"
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
        "Spanish": ["spanish"]
    }

    identified_skills = []

    for skill, keywords in skills_catalog.items():
        if any(
            re.search(
                r"(?<!\w)" + re.escape(keyword) + r"(?!\w)",
                resume_text,
                flags=re.IGNORECASE
            )
            for keyword in keywords
        ):
            identified_skills.append(skill)

    # ------------------------------------------
    # EDUCATION IDENTIFICATION
    # ------------------------------------------

    education_patterns = {
        "Doctorate": r"\b(ph\.?d\.?|doctorate|doctoral degree)\b",
        "Master's Degree": r"\b(m\.?b\.?a\.?|master'?s|m\.?s\.?|m\.?a\.?)\b",
        "Bachelor's Degree": r"\b(b\.?s\.?|b\.?a\.?|bachelor'?s)\b",
        "Associate Degree": r"\b(a\.?s\.?|a\.?a\.?|associate'?s)\b"
    }

    education = [
        degree
        for degree, pattern in education_patterns.items()
        if re.search(pattern, resume_text, re.IGNORECASE)
    ]

    # ------------------------------------------
    # EXPERIENCE IDENTIFICATION
    # ------------------------------------------

    experience_match = re.search(
        r"\b(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?experience\b",
        resume_text,
        re.IGNORECASE
    )

    years_experience = (
        int(experience_match.group(1))
        if experience_match
        else None
    )

    # ------------------------------------------
    # OCCUPATION IDENTIFICATION
    # ------------------------------------------

    occupation_keywords = {
        "Bookkeeper": ["bookkeeper", "bookkeeping"],
        "Accountant": ["accountant"],
        "Administrative Assistant": ["administrative assistant"],
        "Financial Analyst": ["financial analyst"],
        "Software Developer": ["software developer"],
        "Project Manager": ["project manager"],
        "Data Analyst": ["data analyst"],
        "Cybersecurity Analyst": ["cybersecurity analyst"]
    }

    possible_occupations = []

    for occupation, keywords in occupation_keywords.items():
        if any(
            re.search(
                r"(?<!\w)" + re.escape(keyword) + r"(?!\w)",
                resume_text,
                flags=re.IGNORECASE
            )
            for keyword in keywords
        ):
            possible_occupations.append(occupation)

    # ------------------------------------------
    # RETURN STRUCTURED RESULTS
    # ------------------------------------------

    return {
        "status": "success",
        "analysisType": "rule-based",
        "fileName": file_name,
        "skills": identified_skills,
        "education": education,
        "yearsExperience": years_experience,
        "possibleOccupations": possible_occupations,
        "skillsCount": len(identified_skills)
    }
