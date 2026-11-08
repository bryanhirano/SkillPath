"""Composes the three subproblems into one analysis.

Pure Python with no Firebase imports, so it can be unit-tested and reused
(for example from a batch job or a different backend).
"""
from __future__ import annotations

from datetime import datetime, timezone

from .catalog import Catalog
from .extraction import SpanTagger
from .gap import InputError, analyze_gaps, resolve_target, sanitize_levels
from .pathway import Preferences, build_pathway, suggest_electives

ENGINE_VERSION = "0.1.0"


def analyze(payload: dict, catalog: Catalog, tagger: SpanTagger | None = None) -> dict:
    """payload = {skills, target: {roleId} | {title, jobDescription}, preferences, currentRole?}"""
    if not isinstance(payload, dict):
        raise InputError("Request body must be an object.")
    levels = sanitize_levels(payload.get("skills", []), catalog)
    if not levels:
        raise InputError("Add at least one skill before generating a pathway.")
    target = resolve_target(payload.get("target") or {}, catalog, tagger)
    prefs = Preferences.from_dict(payload.get("preferences"), catalog.categories)

    gaps = analyze_gaps(levels, target, catalog, prefs.interests)
    pathway = build_pathway(levels, target, catalog, prefs)
    plan_ids = {s["skillId"] for s in pathway["steps"]}
    electives = suggest_electives(levels, target, plan_ids, catalog, prefs)

    return {
        "engineVersion": ENGINE_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "currentRole": (payload.get("currentRole") or "").strip()[:80] or None,
        "target": target.to_dict(),
        "requirements": [
            {
                "skillId": q.skill_id,
                "level": q.level,
                "importance": q.importance,
            }
            for q in target.requirements
        ],
        "inputSkills": levels,
        "preferences": {
            "hoursPerWeek": prefs.hours_per_week,
            "pace": prefs.pace,
            "formats": prefs.formats,
            "freeOnly": prefs.free_only,
            "interests": prefs.interests,
        },
        **gaps,
        "pathway": pathway,
        "electives": electives,
        "summary": _summary(target.title, gaps, pathway),
    }


def _summary(title: str, gaps: dict, pathway: dict) -> str:
    if not gaps["gaps"]:
        return (
            f"You already meet every core requirement for {title}. "
            "Consider the electives to keep growing."
        )
    top = ", ".join(g["name"] for g in gaps["gaps"][:3])
    weeks = pathway["totalWeeks"]
    return (
        f"You're {gaps['readiness']:.0f}% of the way to {title}. "
        f"The biggest gaps are {top}. At {pathway['hoursPerWeek']:g} hours a week, "
        f"the pathway takes about {weeks} week{'s' if weeks != 1 else ''} "
        f"({pathway['totalHours']} hours)."
    )
