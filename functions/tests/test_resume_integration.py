
"""Tests for the Firebase resume-analysis response."""

from types import SimpleNamespace
from unittest.mock import patch

import main


def test_analyze_resume_returns_education_details():
    resume_text = """
EDUCATION
Bachelor of Science in Computer Science
University of Houston-Downtown
Expected December 2026

SKILLS
Python, SQL, JavaScript

EXPERIENCE
3 years of experience in technical support
"""

    fake_request = SimpleNamespace(
        auth=SimpleNamespace(uid="test-user")
    )

    with patch.object(
        main,
        "_load_resume_text",
        return_value=("sample-resume.pdf", resume_text),
    ):
        result = main.analyze_resume.__wrapped__.__wrapped__(fake_request)
    assert result["status"] == "success"
    assert result["education"] == ["Bachelor's Degree"]

    details = result["educationDetails"]
    assert len(details) == 1
    assert details[0]["degree_level"] == "bachelor"
    assert details[0]["field"] == "Computer Science"
    assert details[0]["graduation_status"] == "expected"
    assert details[0]["graduation_date"] == "December 2026"
