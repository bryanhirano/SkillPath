"""Gap identification (subproblem 2).

Quantifies the difference between the employee's current proficiency and what
the target role (catalog role or pasted job description) requires.
"""
from __future__ import annotations

from dataclasses import dataclass

from .catalog import LEVEL_LABELS, MAX_LEVEL, MIN_LEVEL, Catalog, Requirement
from .extraction import SpanTagger, requirements_from_job_description


class InputError(ValueError):
    """Raised for invalid client input; surfaced to the user as-is."""


@dataclass
class TargetProfile:
    id: str
    title: str
    onet_code: str | None
    onet_title: str | None
    requirements: list[Requirement]
    custom: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "onetCode": self.onet_code,
            "onetTitle": self.onet_title,
            "custom": self.custom,
        }


def sanitize_levels(raw, catalog: Catalog) -> dict[str, int]:
    """Accept {"python": 3} or [{"skillId": "python", "level": 3}] and validate."""
    if isinstance(raw, dict):
        items = raw.items()
    elif isinstance(raw, list):
        items = ((r.get("skillId"), r.get("level")) for r in raw if isinstance(r, dict))
    else:
        raise InputError("skills must be a list of {skillId, level}.")
    levels: dict[str, int] = {}
    for sid, level in items:
        if sid not in catalog.skills:
            continue  # ignore unknown ids rather than failing the whole request
        try:
            lvl = int(level)
        except (TypeError, ValueError):
            raise InputError(f"Level for {sid} must be a number from 0 to 5.") from None
        levels[sid] = max(MIN_LEVEL, min(MAX_LEVEL, lvl))
    return levels


def resolve_target(target: dict, catalog: Catalog, tagger: SpanTagger | None = None) -> TargetProfile:
    if not isinstance(target, dict):
        raise InputError("Choose a target role or paste a job description.")
    role_id = target.get("roleId")
    if role_id:
        role = catalog.roles.get(role_id)
        if not role:
            raise InputError(f"Unknown role: {role_id}")
        return TargetProfile(role.id, role.title, role.onet_code, role.onet_title, list(role.requirements))

    jd = (target.get("jobDescription") or "").strip()
    if len(jd) < 40:
        raise InputError("Paste the full job description (at least a few sentences) or choose a role.")
    reqs = requirements_from_job_description(jd[:20_000], catalog, tagger)
    if len(reqs) < 2:
        raise InputError(
            "We couldn't find enough recognizable skills in that job description. Choose a role from the list instead."
        )
    title = (target.get("title") or "Custom target role").strip()[:80]
    return TargetProfile(
        id="custom",
        title=title,
        onet_code=None,
        onet_title=None,
        requirements=[Requirement(r["skillId"], r["level"], r["importance"]) for r in reqs[:14]],
        custom=True,
    )


def readiness(levels: dict[str, int], requirements: list[Requirement]) -> float:
    """Importance-weighted share of required proficiency already covered (0-100)."""
    total = sum(q.level * q.importance for q in requirements)
    if not total:
        return 100.0
    covered = sum(min(levels.get(q.skill_id, 0), q.level) * q.importance for q in requirements)
    return round(100 * covered / total, 1)


def analyze_gaps(
    levels: dict[str, int], target: TargetProfile, catalog: Catalog, interests: list[str]
) -> dict:
    gaps, strengths = [], []
    for q in target.requirements:
        skill = catalog.skills[q.skill_id]
        current = levels.get(q.skill_id, 0)
        gap = max(0, q.level - current)
        status = "met" if gap == 0 else ("missing" if current == 0 else "partial")
        row = {
            "skillId": q.skill_id,
            "name": skill.name,
            "category": skill.category,
            "current": current,
            "required": q.level,
            "currentLabel": LEVEL_LABELS[current],
            "requiredLabel": LEVEL_LABELS[q.level],
            "gap": gap,
            "importance": q.importance,
            "status": status,
            "interest": skill.category in interests,
            "severity": gap * q.importance,
        }
        (strengths if gap == 0 else gaps).append(row)

    gaps.sort(key=lambda r: (-r["severity"], -r["importance"], r["name"]))
    strengths.sort(key=lambda r: (-r["importance"], r["name"]))
    required_ids = {q.skill_id for q in target.requirements}
    transferable = [
        {"skillId": sid, "name": catalog.skills[sid].name, "level": lvl, "levelLabel": LEVEL_LABELS[lvl]}
        for sid, lvl in sorted(levels.items(), key=lambda kv: -kv[1])
        if sid not in required_ids and lvl >= 3
    ]
    return {
        "readiness": readiness(levels, target.requirements),
        "gaps": gaps,
        "strengths": strengths,
        "transferable": transferable[:8],
    }
