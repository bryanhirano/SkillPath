"""Extract education information from resume text."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import re


DEGREES = [
    ("doctorate", r"\b(?:ph\.?\s*d\.?|doctorate|doctoral degree)\b"),
    ("master", r"\b(?:master(?:'s)?|M\.S\.|M\.A\.|M\.B\.A\.)\b"),
    ("bachelor", r"\b(?:bachelor(?:'s)?|b\.?\s*s\.?|b\.?\s*a\.?)\b"),
    ("associate", r"\b(?:associate(?:'s)?|a\.?\s*s\.?|a\.?\s*a\.?)\b"),
]

FIELD_PATTERN = re.compile(
    r"\b(?:in|of)\s+"
    r"([A-Za-z][A-Za-z &/-]{2,60}?)"
    r"(?=\s*(?:,|\||\n|at\b|from\b|[-–]|$))",
    re.IGNORECASE,
)

INSTITUTION_PATTERN = re.compile(
    r"\b((?:[A-Za-z][A-Za-z.'-]*\s+){0,6}"
    r"(?:University|College|Institute|School)"
    r"(?:\s+of\s+[A-Za-z][A-Za-z &'-]*)?)\b",
    re.IGNORECASE,
)

DATE_PATTERN = re.compile(
    r"\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"[a-z]*\s+)?(?:19|20)\d{2}\b",
    re.IGNORECASE,
)

EXPECTED_PATTERN = re.compile(
    r"\b(expected|anticipated|projected|in progress|currently pursuing|"
    r"pursuing|candidate)\b",
    re.IGNORECASE,
)

COMPLETED_PATTERN = re.compile(
    r"\b(?:graduated|completed|degree awarded|conferred)\b",
    re.IGNORECASE,
)

DEGREE_TITLE_PATTERN = re.compile(
    r"(?:Bachelor|Master|Associate|Doctor)(?:'s)?"
    r"(?:\s+of\s+(?:Science|Arts|Engineering|Business Administration))?",
    re.IGNORECASE,
)

SECTION_HEADERS = {
    "EDUCATION",
    "EXPERIENCE",
    "WORK EXPERIENCE",
    "PROFESSIONAL EXPERIENCE",
    "RELEVANT EXPERIENCE",
    "ADDITIONAL EXPERIENCE",
    "TECHNICAL SKILLS",
    "SKILLS",
    "PROJECTS",
    "CERTIFICATIONS",
    "SUMMARY",
    "PROFESSIONAL SUMMARY",
}


@dataclass
class EducationRecord:
    """Structured representation of a single education entry."""

    degree_level: str
    degree: str
    field: str | None = None
    institution: str | None = None
    graduation_status: str = "unknown"
    graduation_date: str | None = None

    def to_dict(self) -> dict:
        """Convert the education record to a dictionary."""
        return asdict(self)


def find_degree(line: str):
    """Find a degree mentioned in a line."""
    for level, pattern in DEGREES:
        match = re.search(pattern, line, re.IGNORECASE)
        if match:
            return level, match

    return None


def is_boundary(line: str) -> bool:
    """Check whether a line is a known resume section heading."""
    return line.upper().rstrip(":") in SECTION_HEADERS


def _get_education_lines(lines: list[str]) -> list[str]:
    """Restrict lines to the Education section when present."""
    education_start = next(
        (
            index
            for index, line in enumerate(lines)
            if line.upper().rstrip(":") == "EDUCATION"
        ),
        None,
    )
    if education_start is None:
        return lines

    for index in range(education_start + 1, len(lines)):
        if is_boundary(lines[index]):
            return lines[education_start + 1 : index]

    return lines[education_start + 1 :]


def _find_entry_start(lines: list[str], index: int) -> int:
    """Find the starting line index of the education entry at index."""
    start = index
    while start > 0:
        previous = lines[start - 1]
        if not previous or is_boundary(previous) or find_degree(previous):
            break

        # Stop at graduation details belonging to an earlier degree.
        if re.search(
            r"\b(?:graduated|completed|conferred)\b",
            previous,
            re.IGNORECASE,
        ):
            break

        # Stop before a previous institution if another institution
        # already belongs to this entry.
        if INSTITUTION_PATTERN.search(previous) and any(
            INSTITUTION_PATTERN.search(lines[pos])
            for pos in range(start, index + 1)
        ):
            break

        start -= 1
    return start


def _find_entry_end(lines: list[str], index: int) -> int:
    """Find the ending line index of the education entry at index."""
    end = index
    while end + 1 < len(lines):
        following = lines[end + 1]
        if not following or is_boundary(following) or find_degree(following):
            break

        # A new university after graduation details likely belongs
        # to the next degree.
        if INSTITUTION_PATTERN.search(following) and any(
            re.search(
                r"\b(?:graduated|expected|anticipated)\b",
                lines[position],
                re.IGNORECASE,
            )
            for position in range(index + 1, end + 1)
        ):
            break

        end += 1
    return end


def _extract_field(line: str, match_end: int) -> str | None:
    """Extract the field of study from the remainder of a degree line."""
    degree_suffix = re.sub(
        r"^\s+of\s+"
        r"(?:Science|Arts|Engineering|Business Administration)\b",
        "",
        line[match_end:],
        flags=re.IGNORECASE,
    )
    field_match = FIELD_PATTERN.search(degree_suffix)
    return field_match.group(1).strip() if field_match else None


def _extract_institution(entry_lines: list[str]) -> str | None:
    """Extract the institution name without trailing graduation details."""
    for entry_line in entry_lines:
        clean_line = re.split(
            r"\s{2,}|\b(?:Expected Graduation|Graduation Date|"
            r"Graduated|Anticipated Graduation)\s*:",
            entry_line,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        institution_match = INSTITUTION_PATTERN.search(clean_line)
        if institution_match:
            return institution_match.group(1).strip()
    return None


def _extract_status(context: str) -> str:
    """Determine graduation status from the entry context."""
    if EXPECTED_PATTERN.search(context):
        return "expected"
    if COMPLETED_PATTERN.search(context):
        return "completed"
    return "unknown"


def _build_record(
    lines: list[str], index: int, level: str, match: re.Match
) -> EducationRecord:
    """Build an EducationRecord for a matched degree line."""
    line = lines[index]
    start = _find_entry_start(lines, index)
    end = _find_entry_end(lines, index)
    entry_lines = lines[start : end + 1]
    context = " ".join(entry_lines)

    date_match = DATE_PATTERN.search(context)
    degree_match = DEGREE_TITLE_PATTERN.match(line[match.start() :])

    return EducationRecord(
        degree_level=level,
        degree=degree_match.group(0) if degree_match else match.group(0),
        field=_extract_field(line, match.end()),
        institution=_extract_institution(entry_lines),
        graduation_status=_extract_status(context),
        graduation_date=date_match.group(0) if date_match else None,
    )


def extract_education(text: str) -> list[dict]:
    """Extract separate education records from resume text."""
    lines = _get_education_lines([line.strip() for line in text.splitlines()])
    records = []
    seen = set()

    for index, line in enumerate(lines):
        if not line:
            continue

        found = find_degree(line)
        if found is None:
            continue

        level, match = found
        key = (level, line.lower())
        if key not in seen:
            record = _build_record(lines, index, level, match)
            records.append(record.to_dict())
            seen.add(key)

    return records
