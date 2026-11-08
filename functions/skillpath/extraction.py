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
    r"\b(expert|advanced|extensive|deep|architect(?:ed)?|led|lead|owned|designed|mentor(?:ed|ing)?|senior|principal|certified)\b",
    re.I,
)
WEAK_CUES = re.compile(
    r"\b(basic|familiar(?:ity)?|exposure|beginner|introductory|coursework|learning|some experience)\b", re.I
)
YEARS_WINDOW = 25  # characters between "N years" and the skill name
YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b", re.I)
JD_REQUIRED = re.compile(r"\b(required|must|essential|minimum|need(?:ed)?|requirements?)\b", re.I)
JD_OPTIONAL = re.compile(r"\b(nice to have|a plus|bonus|preferred|desirable|optional)\b", re.I)


# --------------------------------------------------------------------------- types


@dataclass
class Mention:
    skill_id: str
    text: str
    sentence: str
    source: str          # "taxonomy" | "bert"
    confidence: float


@dataclass
class ExtractedSkill:
    skill_id: str
    name: str
    category: str
    level: int
    confidence: float
    sources: list[str]
    mentions: int
    evidence: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "skillId": self.skill_id,
            "name": self.name,
            "category": self.category,
            "level": self.level,
            "confidence": round(self.confidence, 2),
            "sources": self.sources,
            "mentions": self.mentions,
            "evidence": self.evidence,
        }


class SpanTagger(Protocol):
    name: str

    def tag(self, sentences: list[str]) -> list[list[tuple[str, float]]]:
        """Return, for each sentence, the (span_text, score) pairs the model found."""


# ------------------------------------------------------------------ BERT tagger


class BertSpanTagger:
    """Wraps one or more Hugging Face BIO token-classification models."""

    def __init__(self, model_ids: tuple[str, ...] = DEFAULT_MODELS, batch_size: int = 16):
        from transformers import pipeline  # imported lazily: heavy

        self.name = "+".join(m.split("/")[-1] for m in model_ids)
        self.batch_size = batch_size
        self._pipes = [
            pipeline("token-classification", model=m, aggregation_strategy="none", device=-1)
            for m in model_ids
        ]

    def tag(self, sentences: list[str]) -> list[list[tuple[str, float]]]:
        results: list[list[tuple[str, float]]] = [[] for _ in sentences]
        for pipe in self._pipes:
            outputs = pipe(sentences, batch_size=self.batch_size)
            for i, (sentence, tokens) in enumerate(zip(sentences, outputs)):
                results[i].extend(decode_bio(sentence, tokens))
        return results


def decode_bio(sentence: str, tokens: list[dict]) -> list[tuple[str, float]]:
    """Merge per-token B/I predictions into character spans.

    Works with plain "B"/"I" labels (JobBERT) and "B-SKILL"/"I-SKILL" style labels.
    Subword pieces ("##ing") always extend the current span.
    """
    spans: list[tuple[int, int, list[float]]] = []
    for tok in tokens:
        label = str(tok.get("entity", "O")).split("-")[0].upper()
        if label not in ("B", "I"):
            continue
        start, end = tok.get("start"), tok.get("end")
        if start is None or end is None:
            continue
        is_subword = str(tok.get("word", "")).startswith("##")
        contiguous = bool(spans) and not sentence[spans[-1][1]:start].strip()
        if spans and contiguous and (label == "I" or is_subword):
            s, _, scores = spans[-1]
            spans[-1] = (s, end, scores + [float(tok.get("score", 0))])
        else:
            spans.append((start, end, [float(tok.get("score", 0))]))
    return [
        (sentence[s:e].strip(" ,.;:()"), sum(sc) / len(sc))
        for s, e, sc in spans
        if sentence[s:e].strip(" ,.;:()")
    ]


_TAGGER: SpanTagger | None = None
_TAGGER_LOADED = False


def get_default_tagger() -> SpanTagger | None:
    """Load the BERT tagger once per warm instance; None if disabled or unavailable."""
    global _TAGGER, _TAGGER_LOADED
    if _TAGGER_LOADED:
        return _TAGGER
    _TAGGER_LOADED = True
    if os.environ.get("SKILLPATH_NER", "bert").lower() in ("off", "0", "false", "none"):
        return None
    models = tuple(m.strip() for m in os.environ.get("SKILLPATH_NER_MODELS", "").split(",") if m.strip())
    try:
        _TAGGER = BertSpanTagger(models or DEFAULT_MODELS)
    except Exception as exc:  # missing deps, no network to the model hub, OOM...
        log.warning("BERT skill tagger unavailable, using taxonomy matcher only: %s", exc)
        _TAGGER = None
    return _TAGGER


# --------------------------------------------------------------- core pipeline


def split_sentences(text: str) -> list[str]:
    pieces: list[str] = []
    for line in text.splitlines():
        line = line.strip(" \t-*•·▪●–")
        if not line:
            continue
        for part in re.split(r"(?<=[.!?;])\s+(?=[A-Z0-9])", line):
            part = part.strip()
            if len(part) > 1:
                pieces.append(part[:600])
    return pieces


def normalize_span(span: str, catalog: Catalog) -> str | None:
    """Map a free-text skill phrase onto a catalog skill id."""
    exact = catalog.resolve_alias(span)
    if exact:
        return exact
    match = catalog.alias_pattern.search(span)
    if match:
        return catalog.resolve_alias(match.group(0))
    close = difflib.get_close_matches(normalize_text(span), list(catalog.alias_index), n=1, cutoff=FUZZY_CUTOFF)
    return catalog.alias_index[close[0]] if close else None


def find_mentions(
    sentences: list[str], catalog: Catalog, tagger: SpanTagger | None
) -> tuple[list[Mention], dict[str, int]]:
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
        except Exception as exc:
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


def estimate_level(mentions: list[tuple[str, str]]) -> int:
    """Heuristic 1-5 proficiency estimate from (sentence, matched text) pairs.

    Years of experience only count when stated close to the skill ("4 years of
    SQL", "Python (6 yrs)"), not for a sentence's overall experience. Users
    confirm or correct every estimate in the review step, so this only has to be
    a sensible starting point.
    """
    unique = list(dict.fromkeys(mentions))
    sentences = list(dict.fromkeys(s for s, _ in unique))
    level = 3 if len(sentences) >= 3 else 2
    years = []
    for sentence, text in unique:
        pos = sentence.lower().find(text.lower())
        for m in YEARS.finditer(sentence):
            if pos >= 0 and (abs(m.end() - pos) <= YEARS_WINDOW or abs(m.start() - (pos + len(text))) <= YEARS_WINDOW):
                years.append(int(m.group(1)))
    if years:
        y = max(years)
        level = max(level, 2 if y < 1 else 3 if y <= 2 else 4 if y <= 5 else 5)
    if any(STRONG_CUES.search(s) for s in sentences):
        level = min(5, level + 1)
    if sentences and all(WEAK_CUES.search(s) for s in sentences):
        level = min(level, 2)
    return max(1, min(5, level))


def _snippet(sentence: str, needle: str, width: int = 140) -> str:
    if len(sentence) <= width:
        return sentence
    idx = max(0, sentence.lower().find(needle.lower()))
    start = max(0, idx - width // 3)
    return ("…" if start else "") + sentence[start:start + width].strip() + "…"


def extract_skills(text: str, catalog: Catalog, tagger: SpanTagger | None = None) -> dict:
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
        confidence = max(m.confidence for m in ms)
        if len(sources) > 1:
            confidence = min(0.99, confidence + 0.05)  # both extractors agree
        skills.append(
            ExtractedSkill(
                skill_id=sid,
                name=skill.name,
                category=skill.category,
                level=estimate_level(pairs),
                confidence=confidence,
                sources=sources,
                mentions=len(set(sents)),
                evidence=evidence,
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
