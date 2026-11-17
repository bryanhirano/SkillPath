
"""Tests for education extraction."""

from skillpath.education import extract_education


def test_expected_bachelors():
    text = (
        "Bachelor of Science in Computer Science, "
        "University of Maryland, Expected December 2026"
    )
    records = extract_education(text)

    assert len(records) == 1
    assert records[0]["degree_level"] == "bachelor"
    assert records[0]["field"] == "Computer Science"
    assert records[0]["graduation_status"] == "expected"
    assert records[0]["graduation_date"] == "December 2026"


def test_masters_degree():
    text = "Master of Science in Data Analytics, 2022"
    records = extract_education(text)

    assert len(records) == 1
    assert records[0]["degree_level"] == "master"
    assert records[0]["field"] == "Data Analytics"
    assert records[0]["graduation_date"] == "2022"
    assert records[0]["graduation_status"] == "unknown"


def test_no_degree():
    text = "Experienced with Python, SQL, and project management."
    assert extract_education(text) == []


def test_multiple_degrees():
    text = (
        "Bachelor of Science in Computer Science, 2020\n"
        "Master of Science in Cybersecurity, Expected 2027"
    )
    records = extract_education(text)

    assert len(records) == 2
    assert records[0]["degree_level"] == "bachelor"
    assert records[1]["degree_level"] == "master"
    assert records[1]["graduation_status"] == "expected"


def test_multiline_education():
    resume = """
EDUCATION
University of Maryland Global Campus
Bachelor of Science in Computer Science
Expected December 2026

TECHNICAL SKILLS
Python, Java, SQL
"""
    records = extract_education(resume)

    assert len(records) == 1
    assert records[0]["degree_level"] == "bachelor"
    assert records[0]["field"] == "Computer Science"
    assert records[0]["institution"] == "University of Maryland Global Campus"
    assert records[0]["graduation_status"] == "expected"
    assert records[0]["graduation_date"] == "December 2026"


def test_two_degrees_without_blank_lines():
    resume = """
EDUCATION
University of Maryland
Bachelor of Science in Computer Science
Graduated May 2020
University of Baltimore
Master of Science in Data Analytics
Expected December 2027

EXPERIENCE
Software Developer
"""
    records = extract_education(resume)

    assert len(records) == 2

    assert records[0]["institution"] == "University of Maryland"
    assert records[0]["field"] == "Computer Science"
    assert records[0]["graduation_date"] == "May 2020"
    assert records[0]["graduation_status"] == "completed"

    assert records[1]["institution"] == "University of Baltimore"
    assert records[1]["field"] == "Data Analytics"
    assert records[1]["graduation_date"] == "December 2027"
    assert records[1]["graduation_status"] == "expected"


def test_microsoft_products_are_not_degrees():
    resume = """
TECHNICAL SKILLS
Databases: MS Access, SQL Server
Office Tools: MS Word, MS Excel, PowerPoint

EDUCATION
University of Houston-Downtown
Bachelor of Science in Computer Science, August 2016
"""

    records = extract_education(resume)

    assert len(records) == 1
    assert records[0]["degree_level"] == "bachelor"
    assert records[0]["field"] == "Computer Science"
    assert records[0]["graduation_date"] == "August 2016"


def test_ignore_degrees_outside_education():
    resume = """
PROFESSIONAL SUMMARY
Mentored employees pursuing master's degrees.

EXPERIENCE
Managed a team of software developers.

EDUCATION
Bachelor of Science in Computer Science
University of Maryland
"""

    records = extract_education(resume)

    assert len(records) == 1
    assert records[0]["degree_level"] == "bachelor"
    assert records[0]["field"] == "Computer Science"
    assert records[0]["institution"] == "University of Maryland"


def test_university_and_expected_date_before_degree():
    resume = """
EDUCATION
UNIVERSITY OF MARYLAND GLOBAL CAMPUS    Expected Graduation: Dec 2026
Bachelor of Science in Computer Science
Relevant Coursework: Data Structures and Algorithms

TECHNICAL SKILLS
Python, Java, SQL
"""
    records = extract_education(resume)

    assert len(records) == 1
    assert records[0]["degree_level"] == "bachelor"
    assert records[0]["degree"] == "Bachelor of Science"
    assert records[0]["field"] == "Computer Science"
    assert records[0]["institution"] == "UNIVERSITY OF MARYLAND GLOBAL CAMPUS"
    assert records[0]["graduation_status"] == "expected"
    assert records[0]["graduation_date"] == "Dec 2026"
