"""Skill extraction and normalization.

Two complementary extractors feed one normalizer:

1. Taxonomy matcher - fast, high-precision alias matching against the catalog
   (the O*NET-style "occupational benchmark" from the design doc).
2. BERT span tagger - Hugging Face token-classification models fine-tuned for
   skill extraction (JobBERT, Zhang et al. 2022). It finds skill phrases the
   alias list does not know about; each span is normalized back onto the
   catalog, and anything that cannot be mapped is returned as "unmapped" for
   the user to review instead of being silently dropped.

The BERT tagger is optional: if transformers/torch are not installed or
SKILLPATH_NER=off, extraction falls back to the taxonomy matcher alone.
"""
from __future__ import annotations

import difflib
import logging
import os
import re
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol


from .catalog import Catalog, normalize_text

log = logging.getLogger(__name__)

DEFAULT_MODELS = (
    "jjzha/jobbert_skill_extraction",      # skills: "manage stakeholder expectations"
    "jjzha/jobbert_knowledge_extraction",  # knowledge: "Python", "AWS"
)
BERT_MIN_SCORE = 0.55
FUZZY_CUTOFF = 0.88

STRONG_CUES = re.compile(
    r"\b(expert|advanced|extensive|deep|architect(?:ed)?|led|lead|owned|designed|"
    r"mentor(?:ed|ing)?|senior|principal|certified)\b",
    re.I,
)
WEAK_CUES = re.compile(
    r"\b(basic|familiar(?:ity)?|exposure|beginner|introductory|coursework|"
    r"learning|some experience)\b",
    re.I,
)
YEARS_WINDOW = 25  # characters between "N years" and the skill name
YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b", re.I)
JD_REQUIRED = re.compile(r"\b(required|must|essential|minimum|need(?:ed)?|requirements?)\b", re.I)
JD_OPTIONAL = re.compile(r"\b(nice to have|a plus|bonus|preferred|desirable|optional)\b", re.I)


# --------------------------------------------------------------------------- types


@dataclass
class Mention:
    """A single skill mention found in a resume or job description."""

    skill_id: str
    text: str
    sentence: str
    source: str          # "taxonomy" | "bert"
    confidence: float


@dataclass
class ExtractedSkill:  # pylint: disable=too-many-instance-attributes
    """A normalized skill with proficiency estimate and supporting evidence."""

    skill_id: str
    name: str
    category: str
    level: int
    confidence: float
    sources: list[str]
    mentions: int
    evidence: list[str] = field(default_factory=list)
    level_reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Return the skill in the callable API representation."""
        return {
            "skillId": self.skill_id,
            "name": self.name,
            "category": self.category,
            "level": self.level,
            "confidence": round(self.confidence, 2),
            "sources": self.sources,
            "mentions": self.mentions,
            "evidence": self.evidence,
            "levelReasons": self.level_reasons,
        }


class SpanTagger(Protocol):  # pylint: disable=too-few-public-methods
    """Interface implemented by optional skill span taggers."""

    name: str

    def tag(self, sentences: list[str]) -> list[list[tuple[str, float]]]:
        """Return, for each sentence, the (span_text, score) pairs the model found."""


# ------------------------------------------------------------------ BERT tagger


class BertSpanTagger:  # pylint: disable=too-few-public-methods
    """Wraps one or more Hugging Face BIO token-classification models."""

    def __init__(self, model_ids: tuple[str, ...] = DEFAULT_MODELS, batch_size: int = 16):
        # Optional, heavyweight dependency; load only if BERT tagging is enabled.
        from transformers import pipeline  # pylint: disable=import-error,import-outside-toplevel

        self.name = "+".join(m.rsplit("/", maxsplit=1)[-1] for m in model_ids)
        self.batch_size = batch_size
        self._pipes = [
            pipeline("token-classification", model=m, aggregation_strategy="none", device=-1)
            for m in model_ids
        ]

    def tag(self, sentences: list[str]) -> list[list[tuple[str, float]]]:
        """Return candidate skill spans and confidence scores per sentence."""
        results: list[list[tuple[str, float]]] = [[] for _ in sentences]
        for pipe in self._pipes:
            outputs = pipe(sentences, batch_size=self.batch_size)
            for i, (sentence, tokens) in enumerate(zip(sentences, outputs)):
                results[i].extend(decode_bio(sentence, tokens))
        return results




def decode_bio(sentence: str, tokens: list[dict]) -> list[tuple[str, float]]:
    """Combine BERT token predictions into complete skill phrases."""
    results = []
    current_start = None
    current_end = None
    current_scores = []

    def save_span():
        if current_start is None or current_end is None:
            return

        phrase = sentence[current_start:current_end].strip(" ,.;:()")
        if phrase:
            confidence = sum(current_scores) / len(current_scores)
            results.append((phrase, confidence))

    for token in sorted(tokens, key=lambda t: t.get("start") or 0):
        label = str(token.get("entity", "O")).upper().split("-", 1)[0]
        start = token.get("start")
        end = token.get("end")

        if start is None or end is None:
            continue

        if not 0 <= start < end <= len(sentence):
            continue

        if label not in ("B", "I"):
            save_span()
            current_start = None
            current_end = None
            current_scores = []
            continue

        score = float(token.get("score", 0.0))

        if current_start is None:
            current_start = start
            current_end = end
            current_scores = [score]
            continue

        # Join subword tokens even when BERT incorrectly labels them B.
        # Examples: S + ##QL = SQL, Re + ##act = React.
        same_word = (
            start == current_end
            and (
                str(token.get("word", "")).startswith("##")
                or sentence[start:end] in ("+", "#")
            )
        )

        if same_word:
            current_end = end
            current_scores.append(score)
            continue

        # Continue multiword phrases when BERT uses the I label.
        gap = sentence[current_end:start]

        if label == "I" and start >= current_end and not gap.strip():
            current_end = end
            current_scores.append(score)
            continue

        # Otherwise, start a new entity.
        save_span()
        current_start = start
        current_end = end
        current_scores = [score]

    save_span()
    return results




@lru_cache(maxsize=1)
def get_default_tagger() -> SpanTagger | None:
    """Load the BERT tagger once per warm instance; None if disabled or unavailable."""
    if os.environ.get("SKILLPATH_NER", "bert").lower() in ("off", "0", "false", "none"):
        return None
    models = tuple(
        model.strip()
        for model in os.environ.get("SKILLPATH_NER_MODELS", "").split(",")
        if model.strip()
    )
    try:
        return BertSpanTagger(models or DEFAULT_MODELS)
    except Exception as exc:  # pylint: disable=broad-exception-caught
        # Model loading can fail in several optional dependency and runtime paths.
        # Keep the optional tagger fail-soft; taxonomy matching remains available.
        log.warning("BERT skill tagger unavailable, using taxonomy matcher only: %s", exc)
        return None


# --------------------------------------------------------------- core pipeline



def split_sentences(text: str) -> list[str]:
    """Split resume text into bounded chunks without discarding content."""
    pieces: list[str] = []
    max_length = 400

    for line in text.splitlines():
        line = line.strip(" \t-*•·▪●–")
        if not line:
            continue

        for part in re.split(r"(?<=[.!?;])\s+(?=[A-Z0-9])", line):
            part = part.strip()
            if len(part) <= 1:
                continue

            while len(part) > max_length:
                # Prefer splitting at a space rather than inside a word.
                split_at = part.rfind(" ", 0, max_length + 1)

                if split_at <= 0:
                    # Handle unusually long strings without spaces.
                    split_at = max_length

                chunk = part[:split_at].strip()
                if chunk:
                    pieces.append(chunk)

                part = part[split_at:].strip()

            if part:
                pieces.append(part)

    return pieces




def normalize_span(span: str, catalog: Catalog) -> str | None:
    """Map a BERT skill phrase to a catalog skill without unsafe partial matches."""

    phrase = span.strip()
    if not phrase:
        return None

    # 1. Prefer exact catalog matches.
    exact = catalog.resolve_alias(phrase)
    if exact:
        return exact

    # 2. Allow a known skill followed by a generic description.
    # Example: "Python programming" -> "Python"
    generic_suffixes = (
        " programming",
        " development",
        " experience",
        " skills",
        " proficiency",
        " knowledge",
        " expertise",
    )

    normalized = normalize_text(phrase)

    for suffix in generic_suffixes:
        if normalized.endswith(suffix):
            base = normalized[:-len(suffix)].strip()
            if base:
                skill_id = catalog.resolve_alias(base)
                if skill_id:
                    return skill_id

    # 3. Allow minor spelling variations, but not different technologies.
    # Avoid fuzzy matching short names like SQL, Java, C++, or C#.
    if len(normalized) >= 8:
        close = difflib.get_close_matches(
            normalized,
            list(catalog.alias_index),
            n=1,
            cutoff=0.94,
        )

        if close:
            return catalog.alias_index[close[0]]

    # 4. Keep unknown skills unmapped for review.
    return None


def find_mentions(
    sentences: list[str], catalog: Catalog, tagger: SpanTagger | None
) -> tuple[list[Mention], dict[str, int]]:
    """Find catalog skill aliases and optional model-tagged skill phrases."""
    mentions: list[Mention] = []
    unmapped: dict[str, int] = defaultdict(int)

    for sentence in sentences:
        for m in catalog.alias_pattern.finditer(sentence):
            sid = catalog.resolve_alias(m.group(0))
            if sid:
                mentions.append(Mention(sid, m.group(0), sentence, "taxonomy", 0.9))

    if tagger is not None:
        try:
            tagged = tagger.tag(sentences)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # A failed optional model should not prevent taxonomy-based results.
            log.warning("BERT tagging failed, continuing with taxonomy matches: %s", exc)
            tagged = []
        for sentence, spans in zip(sentences, tagged):
            for span, score in spans:
                if score < BERT_MIN_SCORE or len(span) > 80:
                    continue
                sid = normalize_span(span, catalog)
                if sid:
                    mentions.append(Mention(sid, span, sentence, "bert", 0.6 + 0.35 * score))
                elif 2 < len(span) <= 60:
                    unmapped[normalize_text(span)] += 1
    return mentions, unmapped


LEVEL_NAMES = {1: "Awareness", 2: "Beginner", 3: "Intermediate", 4: "Advanced", 5: "Expert"}


def _lvl(level: int) -> str:
    return f"{LEVEL_NAMES[level]} ({level})"


def _nearby_years(mentions: list[tuple[str, str]]) -> list[tuple[int, str]]:
    """Find experience durations stated close to each mentioned skill."""
    years = []
    for sentence, text in mentions:
        pos = sentence.lower().find(text.lower())
        for match in YEARS.finditer(sentence):
            near_start = abs(match.end() - pos) <= YEARS_WINDOW
            near_end = abs(match.start() - (pos + len(text))) <= YEARS_WINDOW
            if pos >= 0 and (near_start or near_end):
                years.append((int(match.group(1)), match.group(0).strip()))
    return years


def _apply_year_adjustment(
    level: int, years: list[tuple[int, str]], reasons: list[str]
) -> int:
    """Apply the proficiency floor implied by the strongest nearby duration."""
    if not years:
        return level

    years_count, phrase = max(years)
    floor = 2 if years_count < 1 else 3 if years_count <= 2 else 4 if years_count <= 5 else 5
    if floor > level:
        reasons.append(f"\u201c{phrase}\u201d stated next to it: raised to {_lvl(floor)}.")
        return floor

    reasons.append(
        f"\u201c{phrase}\u201d stated next to it: supports {_lvl(floor)}, "
        "no change."
    )
    return level


def _apply_cue_adjustments(level: int, sentences: list[str], reasons: list[str]) -> int:
    """Adjust proficiency for strong or beginner wording."""
    strong = next((m.group(0) for s in sentences if (m := STRONG_CUES.search(s))), None)
    if strong:
        new_level = min(5, level + 1)
        reasons.append(
            f"Strong wording (\u201c{strong}\u201d): +1 to {_lvl(new_level)}."
            if new_level > level
            else f"Strong wording (\u201c{strong}\u201d): already at the maximum."
        )
        level = new_level

    if sentences and all(WEAK_CUES.search(s) for s in sentences):
        weak = WEAK_CUES.search(sentences[0]).group(0)
        if level > 2:
            reasons.append(
                f"Only described with beginner wording (\u201c{weak}\u201d): "
                f"capped at {_lvl(2)}."
            )
        else:
            reasons.append(f"Beginner wording (\u201c{weak}\u201d) keeps it at {_lvl(level)}.")
        level = min(level, 2)

    return level


def explain_level(mentions: list[tuple[str, str]]) -> tuple[int, list[str]]:
    """Heuristic 1-5 proficiency estimate, plus one plain sentence per rule applied.

    ``mentions`` are (sentence, matched text) pairs. Years of experience only
    count when stated close to the skill ("4 years of SQL", "Python (6 yrs)"),
    not for a sentence's overall experience. The reasons are shown to users so
    they can judge the estimate and correct it.
    """
    unique = list(dict.fromkeys(mentions))
    sentences = list(dict.fromkeys(s for s, _ in unique))
    n = len(sentences)
    level = 3 if n >= 3 else 2
    reasons = [
        f"Mentioned in {n} sentence{'s' if n != 1 else ''}, so it starts at {_lvl(level)}."
        + ("" if n >= 3 else f" 3 or more mentions would start at {_lvl(3)}.")
    ]

    years = _nearby_years(unique)
    level = _apply_year_adjustment(level, years, reasons)
    level = _apply_cue_adjustments(level, sentences, reasons)

    return max(1, min(5, level)), reasons


def estimate_level(mentions: list[tuple[str, str]]) -> int:
    """Heuristic 1-5 proficiency estimate from (sentence, matched text) pairs."""
    return explain_level(mentions)[0]


def apply_level_overrides(skills: list[dict], overrides) -> list[dict]:
    """Apply levels the user set themselves on top of the estimated ones.

    ``skills`` are ``ExtractedSkill.to_dict()`` rows; ``overrides`` maps
    skillId -> level (0-5) as stored for the user. Every row gets
    ``estimatedLevel`` (the heuristic's value) and ``userSet``. Overrides for
    skills not found in the resume, or with invalid values, are ignored.
    """
    overrides = overrides if isinstance(overrides, dict) else {}
    out = []
    for row in skills:
        row = {**row, "estimatedLevel": row["level"], "userSet": False}
        value = overrides.get(row["skillId"])
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 5:
            row["level"] = value
            row["userSet"] = True
        out.append(row)
    out.sort(key=lambda r: (-r["level"], -r.get("confidence", 0), r["name"]))
    return out


def _snippet(sentence: str, needle: str, width: int = 140) -> str:
    if len(sentence) <= width:
        return sentence
    idx = max(0, sentence.lower().find(needle.lower()))
    start = max(0, idx - width // 3)
    return ("…" if start else "") + sentence[start:start + width].strip() + "…"


# pylint: disable=too-many-locals
def extract_skills(text: str, catalog: Catalog, tagger: SpanTagger | None = None) -> dict:
    """Identify skills in text and return estimates with evidence and metadata."""
    sentences = split_sentences(text)
    mentions, unmapped = find_mentions(sentences, catalog, tagger)

    by_skill: dict[str, list[Mention]] = defaultdict(list)
    for m in mentions:
        by_skill[m.skill_id].append(m)

    skills: list[ExtractedSkill] = []
    for sid, ms in by_skill.items():
        skill = catalog.skills[sid]
        sents = [m.sentence for m in ms]
        pairs = [(m.sentence, m.text) for m in ms]
        evidence = list(dict.fromkeys(_snippet(m.sentence, m.text) for m in ms))[:2]
        sources = sorted({m.source for m in ms})
        level, reasons = explain_level(pairs)
        confidence = max(m.confidence for m in ms)
        if len(sources) > 1:
            confidence = min(0.99, confidence + 0.05)  # both extractors agree
        skills.append(
            ExtractedSkill(
                skill_id=sid,
                name=skill.name,
                category=skill.category,
                level=level,
                confidence=confidence,
                sources=sources,
                mentions=len(set(sents)),
                evidence=evidence,
                level_reasons=reasons,
            )
        )
    skills.sort(key=lambda s: (-s.level, -s.confidence, s.name))

    return {
        "skills": [s.to_dict() for s in skills],
        "unmapped": [
            {"text": t, "count": c}
            for t, c in sorted(unmapped.items(), key=lambda kv: (-kv[1], kv[0]))[:15]
        ],
        "model": tagger.name if tagger else "taxonomy-only",
        "sentenceCount": len(sentences),
    }


# ------------------------------------------------- job description -> target role


def requirements_from_job_description(
    text: str, catalog: Catalog, tagger: SpanTagger | None = None
) -> list[dict]:
    """Build a custom target-role profile from a pasted job description."""
    sentences = split_sentences(text)
    mentions, _ = find_mentions(sentences, catalog, tagger)
    by_skill: dict[str, list[str]] = defaultdict(list)
    for m in mentions:
        by_skill[m.skill_id].append(m.sentence)

    reqs = []
    for sid, sents in by_skill.items():
        unique = list(dict.fromkeys(sents))
        level, importance = 3, 3
        years = [int(y) for s in unique for y in YEARS.findall(s)]
        if years and max(years) >= 5:
            level = 4
        if any(STRONG_CUES.search(s) for s in unique):
            level = 4
        if any(JD_REQUIRED.search(s) for s in unique):
            importance += 1
        if len(unique) >= 2:
            importance += 1
        if all(JD_OPTIONAL.search(s) or WEAK_CUES.search(s) for s in unique):
            level, importance = 2, 2
        reqs.append({"skillId": sid, "level": level, "importance": min(5, importance)})
    reqs.sort(key=lambda r: (-r["importance"], -r["level"], r["skillId"]))
    return reqs
