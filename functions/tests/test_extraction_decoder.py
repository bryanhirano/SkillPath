
"""Regression tests for JobBERT token decoding."""

from skillpath.extraction import decode_bio


def make_token(word, label, start, end):
    return {
        "word": word,
        "entity": label,
        "start": start,
        "end": end,
        "score": 0.99,
    }


def test_sql():
    tokens = [
        make_token("S", "B", 0, 1),
        make_token("##QL", "B", 1, 3),
    ]
    assert decode_bio("SQL", tokens)[0][0] == "SQL"


def test_mysql():
    tokens = [
        make_token("My", "B", 0, 2),
        make_token("##S", "B", 2, 3),
        make_token("##QL", "B", 3, 5),
    ]
    assert decode_bio("MySQL", tokens)[0][0] == "MySQL"


def test_cpp():
    tokens = [
        make_token("C", "B", 0, 1),
        make_token("+", "B", 1, 2),
        make_token("+", "B", 2, 3),
    ]
    assert decode_bio("C++", tokens)[0][0] == "C++"


def test_multiword_phrase():
    tokens = [
        make_token("Python", "B", 0, 6),
        make_token("applications", "I", 7, 19),
    ]
    assert decode_bio("Python applications", tokens)[0][0] == "Python applications"


def test_separate_entities():
    tokens = [
        make_token("Python", "B", 0, 6),
        make_token("Java", "B", 11, 15),
    ]
    results = decode_bio("Python and Java", tokens)
    assert [phrase for phrase, _ in results] == ["Python", "Java"]
