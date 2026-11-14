"""Target-job selection: list the roles a user can aim for and analyze a chosen one.

Pure Python (no Firebase imports) so the callable handlers stay thin and testable.
"""
from __future__ import annotations

from typing import Callable

from .catalog import Catalog
from .engine import analyze
from .extraction import SpanTagger
from .gap import InputError, resolve_target, sanitize_levels

MAX_JD_CHARS = 20_000


def role_options(catalog: Catalog) -> list[dict]:
    """Return catalog roles as dropdown options, sorted by title."""
    return sorted(
        (
            {
                "id": r.id,
                "title": r.title,
                "onetCode": r.onet_code,
                "onetTitle": r.onet_title,
                "requirementCount": len(r.requirements),
            }
            for r in catalog.roles.values()
        ),
        key=lambda r: r["title"].casefold(),
    )


def clean_target(raw) -> dict:
    """Validate the client's target selection and keep only the fields we store."""
    if not isinstance(raw, dict):
        raise InputError("Choose a target job or paste a job description.")
    role_id = raw.get("roleId")
    if role_id:
        if not isinstance(role_id, str):
            raise InputError("Choose a target job from the list.")
        return {"roleId": role_id}
    jd = raw.get("jobDescription")
    if not isinstance(jd, str) or not jd.strip():
        raise InputError("Choose a target job or paste a job description.")
    title = raw.get("title") if isinstance(raw.get("title"), str) else ""
    return {
        "title": title.strip()[:80] or "Custom target role",
        "jobDescription": jd.strip()[:MAX_JD_CHARS],
    }


def select_target(
    payload: dict,
    catalog: Catalog,
    tagger_factory: Callable[[], SpanTagger | None] = lambda: None,
) -> dict:
    """Validate a target selection and, when skills are supplied, analyze it.

    payload = {target: {roleId} | {title, jobDescription}, skills?, preferences?, currentRole?}

    Returns {"target": <stored selection>, "analysis": <engine output or None>}.
    The BERT tagger is only loaded for pasted job descriptions; catalog roles
    never need it.
    """
    if not isinstance(payload, dict):
        raise InputError("Request body must be an object.")
    target = clean_target(payload.get("target"))
    tagger = tagger_factory() if "jobDescription" in target else None

    levels = sanitize_levels(payload.get("skills") or [], catalog)
    if not levels:
        # No skills yet: still validate, so an unknown role or unusable job
        # description is rejected before it is saved.
        profile = resolve_target(target, catalog, tagger)
        stored = {**target, "resolvedTitle": profile.title, "custom": profile.custom}
        return {"target": stored, "analysis": None}

    analysis = analyze(
        {
            "skills": levels,
            "target": target,
            "preferences": payload.get("preferences"),
            "currentRole": payload.get("currentRole"),
        },
        catalog,
        tagger,
    )
    stored = {
        **target,
        "resolvedTitle": analysis["target"]["title"],
        "custom": analysis["target"]["custom"],
    }
    return {"target": stored, "analysis": analysis}
