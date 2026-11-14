
"""Extract education information from resume text."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass


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
    degree_level: str
    degree: str
    field: str | None = None
    institution: str | None = None
    graduation_status: str = "unknown"
    graduation_date: str | None = None

    def to_dict(self) -> dict:
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


def extract_education(text: str) -> list[dict]:
    """Extract separate education records from resume text."""

    lines = [line.strip() for line in text.splitlines()]
    records = []
    seen = set()

    # Restrict extraction to the Education section when present.
    education_start = next(
        (
            index
            for index, line in enumerate(lines)
            if line.upper().rstrip(":") == "EDUCATION"
        ),
        None,
    )

    if education_start is not None:
        education_end = len(lines)

        for index in range(education_start + 1, len(lines)):
            if is_boundary(lines[index]):
                education_end = index
                break

        lines = lines[education_start + 1:education_end]

    # Identify each degree separately.
    for index, line in enumerate(lines):
        if not line:
            continue

        found = find_degree(line)

        if found is None:
            continue

        level, match = found

        # Find the beginning of this education entry.
        start = index


        while start > 0:
            previous = lines[start - 1]

            if not previous or is_boundary(previous):
                break

            if find_degree(previous):
                break

            # Stop at graduation details belonging to an earlier degree.
            if re.search(
                r"\b(?:graduated|completed|conferred)\b",
                previous,
                re.IGNORECASE,
            ):
                break

            # Stop before a previous institution if another
            # institution already belongs to this entry.
            if INSTITUTION_PATTERN.search(previous):
                if any(
                    INSTITUTION_PATTERN.search(lines[pos])
                    for pos in range(start, index + 1)
                ):
                    break

            start -= 1


        # Find the end of this education entry.
        end = index

        while end + 1 < len(lines):
            following = lines[end + 1]

            if not following or is_boundary(following):
                break

            if find_degree(following):
                break

            # A new university after graduation details
            # likely belongs to the next degree.
            if (
                INSTITUTION_PATTERN.search(following)
                and any(
                    re.search(
                        r"\b(?:graduated|expected|anticipated)\b",
                        lines[position],
                        re.IGNORECASE,
                    )
                    for position in range(index + 1, end + 1)
                )
            ):
                break

            end += 1

        entry_lines = lines[start:end + 1]
        context = " ".join(entry_lines)

        # Extract field of study.
        degree_suffix = line[match.end():]
        degree_suffix = re.sub(
            r"^\s+of\s+"
            r"(?:Science|Arts|Engineering|Business Administration)\b",
            "",
            degree_suffix,
            flags=re.IGNORECASE,
        )
        field_match = FIELD_PATTERN.search(degree_suffix)

        # Extract institution without including graduation details.
        institution_match = None

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
                break

        # Extract graduation date.
        date_match = DATE_PATTERN.search(context)

        # Determine graduation status.
        if EXPECTED_PATTERN.search(context):
            status = "expected"
        elif COMPLETED_PATTERN.search(context):
            status = "completed"
        else:
            status = "unknown"

        degree_match = re.match(
            r"(?:Bachelor|Master|Associate|Doctor)(?:'s)?"
            r"(?:\s+of\s+(?:Science|Arts|Engineering|Business Administration))?",
            line[match.start():],
            re.IGNORECASE,
        )

        record = EducationRecord(
            degree_level=level,
            degree=degree_match.group(0) if degree_match else match.group(0),
            field=field_match.group(1).strip() if field_match else None,
            institution=(
                institution_match.group(1).strip()
                if institution_match else None
            ),
            graduation_status=status,
            graduation_date=date_match.group(0) if date_match else None,
        )

        key = (level, line.lower())

        if key not in seen:
            records.append(record.to_dict())
            seen.add(key)

    return records
