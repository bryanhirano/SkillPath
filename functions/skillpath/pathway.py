"""Pathway generation (subproblem 3).

Turns the gap report into an ordered, prerequisite-aware sequence of learning
steps, each with resources, a reason ("why this step"), and a predicted
time-to-competency based on the learner's weekly hours and pace.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

from .catalog import LEVEL_LABELS, Catalog, Resource
from .gap import InputError, TargetProfile, readiness

PREREQ_LEVEL = 2  # a prerequisite counts as satisfied at "Beginner"
# Each level costs more than the one before: reaching Expert takes far longer than Awareness.
LEVEL_COST = {1: 0.5, 2: 0.75, 3: 1.0, 4: 1.5, 5: 2.0}
PACE_FACTOR = {"slow": 1.3, "steady": 1.0, "fast": 0.8}
FAMILIARITY_DISCOUNT = 0.85  # already strong in the same category -> learns faster
FORMATS = {"course", "docs", "interactive", "book", "certification", "project"}
PROJECT_CONTEXT = {
    "programming": "a small tool or service",
    "web": "a small web app",
    "data": "an analysis of a public dataset",
    "ml": "a model trained on a public dataset",
    "cloud": "a deployed side project",
    "security": "a hardening review of a lab environment",
    "management": "a small initiative with a real team",
    "business": "a real meeting, document or analysis",
}


@dataclass
class Preferences:
    """Validated study preferences used to tailor a learning pathway."""

    hours_per_week: float = 6
    pace: str = "steady"
    formats: list[str] = field(default_factory=list)
    free_only: bool = False
    interests: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, raw: dict | None, categories: dict[str, str]) -> "Preferences":
        """Validate and normalize client-supplied study preferences."""
        raw = raw or {}
        try:
            hours = float(raw.get("hoursPerWeek", 6))
        except (TypeError, ValueError):
            raise InputError("Hours per week must be a number.") from None
        if not 1 <= hours <= 40:
            raise InputError("Hours per week must be between 1 and 40.")
        pace = raw.get("pace", "steady")
        if pace not in PACE_FACTOR:
            raise InputError("Pace must be slow, steady or fast.")
        return cls(
            hours_per_week=hours,
            pace=pace,
            formats=[f for f in raw.get("formats", []) if f in FORMATS],
            free_only=bool(raw.get("freeOnly", False)),
            interests=[c for c in raw.get("interests", []) if c in categories],
        )


@dataclass
class Node:
    """A skill-level transition in the prerequisite-aware learning plan."""

    skill_id: str
    from_level: int
    to_level: int
    importance: int
    induced_by: list[str] = field(default_factory=list)  # set when added only as a prerequisite
    deps: set[str] = field(default_factory=set)          # prerequisite nodes in the plan
    priority: float = 0.0


def _lower_first(label: str) -> str:
    """Lowercase the first character of a display label."""
    return label[:1].lower() + label[1:]


def hours_to_level(hours_per_level: float, from_level: int, to_level: int) -> float:
    """Estimate study hours to advance between two proficiency levels."""
    return hours_per_level * sum(LEVEL_COST[lvl] for lvl in range(from_level + 1, to_level + 1))


def _plan_nodes(levels: dict[str, int], target: TargetProfile, catalog: Catalog) -> dict[str, Node]:
    """Create missing target skills and their unmet prerequisites."""
    nodes: dict[str, Node] = {}
    for q in target.requirements:
        cur = levels.get(q.skill_id, 0)
        if cur < q.level:
            nodes[q.skill_id] = Node(q.skill_id, cur, q.level, q.importance)

    # Prerequisite closure: pull in unmet prerequisites (recursively) and wire edges.
    queue = list(nodes)
    while queue:
        sid = queue.pop()
        for p in catalog.skills[sid].prerequisites:
            if p in nodes:
                nodes[sid].deps.add(p)
                if nodes[p].induced_by:
                    nodes[p].induced_by.append(sid)
                continue
            if levels.get(p, 0) >= PREREQ_LEVEL:
                continue
            nodes[p] = Node(p, levels.get(p, 0), PREREQ_LEVEL, 2, induced_by=[sid])
            nodes[sid].deps.add(p)
            queue.append(p)
    return nodes


def _descendants(nodes: dict[str, Node]) -> dict[str, set[str]]:
    """Map each skill to all later plan steps that depend on it."""
    children: dict[str, set[str]] = {sid: set() for sid in nodes}
    for sid, n in nodes.items():
        for d in n.deps:
            children[d].add(sid)
    memo: dict[str, set[str]] = {}

    def walk(sid: str) -> set[str]:
        if sid not in memo:
            out: set[str] = set()
            for c in children[sid]:
                out |= {c} | walk(c)
            memo[sid] = out
        return memo[sid]

    return {sid: walk(sid) for sid in nodes}


def _order(
    nodes: dict[str, Node], catalog: Catalog, prefs: Preferences
) -> tuple[list[str], dict[str, set[str]]]:
    """Order skills by dependency, then by priority among ready steps."""
    desc = _descendants(nodes)
    for sid, n in nodes.items():
        interest = 1.25 if catalog.skills[sid].category in prefs.interests else 1.0
        n.priority = n.importance * (n.to_level - n.from_level) * interest + 0.75 * len(desc[sid])

    # Kahn's algorithm; among steps that are ready, take the highest priority first.
    indegree = {sid: len(n.deps) for sid, n in nodes.items()}
    ready = [
        (-n.priority, catalog.skills[sid].name, sid)
        for sid, n in nodes.items()
        if indegree[sid] == 0
    ]
    heapq.heapify(ready)
    order: list[str] = []
    while ready:
        _, _, sid = heapq.heappop(ready)
        order.append(sid)
        for other, n in nodes.items():
            if sid in n.deps:
                indegree[other] -= 1
                if indegree[other] == 0:
                    heapq.heappush(ready, (-n.priority, catalog.skills[other].name, other))
    if len(order) != len(nodes):  # only possible with a cyclic catalog, which validation rejects
        raise RuntimeError("Prerequisite cycle in skill catalog")
    return order, desc


def pick_resources(
    skill_id: str,
    from_level: int,
    to_level: int,
    catalog: Catalog,
    prefs: Preferences,
) -> list[dict]:
    """Select the most relevant resources for the requested skill levels."""
    span = set(range(from_level + 1, to_level + 1))
    scored: list[tuple[float, Resource]] = []
    for r in catalog.resources:
        if skill_id not in r.skills or (prefs.free_only and r.cost != "free"):
            continue
        covered = span & set(range(r.min_level, r.max_level + 1))
        if not covered or r.min_level > from_level + 1:
            continue  # irrelevant, or assumes more than the learner has
        score = 2 * len(covered) / len(span)
        score += 1.0 if r.format in prefs.formats else 0
        score += 0.5 if r.cost == "free" else 0
        score -= 0.3 * (len(r.skills) - 1) / 5  # prefer focused resources
        scored.append((score, r))
    scored.sort(key=lambda t: (-t[0], t[1].hours))
    return [
        {
            "id": r.id,
            "title": r.title,
            "provider": r.provider,
            "url": r.url,
            "format": r.format,
            "hours": r.hours,
            "cost": r.cost,
        }
        for _, r in scored[:2]
    ]


def practice_project(skill_id: str, to_level: int, hours: float, catalog: Catalog) -> dict:
    """Create a practice project appropriate to the target skill level."""
    skill = catalog.skills[skill_id]
    ctx = PROJECT_CONTEXT.get(skill.category, "a small project")
    if to_level <= 2:
        text = f"Practice: use {skill.name} in {ctx}, following a tutorial end to end."
    elif to_level == 3:
        text = (
            f"Project: apply {skill.name} on your own in {ctx}, "
            "then ask a colleague to review it."
        )
    else:
        text = (
            f"Stretch: lead {skill.name} work in {ctx} at work, "
            "and share what you learned with your team."
        )
    return {
        "id": f"project-{skill_id}-{to_level}",
        "title": text,
        "provider": "Hands-on",
        "url": None,
        "format": "project",
        "hours": round(hours * 0.3),
        "cost": "free",
    }


# pylint: disable=too-many-locals
def build_pathway(
    levels: dict[str, int], target: TargetProfile, catalog: Catalog, prefs: Preferences
) -> dict:
    """Build ordered learning steps, milestones, and readiness projections."""
    nodes = _plan_nodes(levels, target, catalog)
    order, desc = _order(nodes, catalog, prefs)
    pace = PACE_FACTOR[prefs.pace]
    strong_categories = {catalog.skills[s].category for s, lvl in levels.items() if lvl >= 3}
    required = {q.skill_id: q for q in target.requirements}

    steps: list[dict] = []
    running = dict(levels)
    elapsed = 0.0
    projection = [{"week": 0, "readiness": readiness(running, target.requirements)}]

    for i, sid in enumerate(order, start=1):
        n, skill = nodes[sid], catalog.skills[sid]
        hours = hours_to_level(skill.hours_per_level, n.from_level, n.to_level) * pace
        if skill.category in strong_categories:
            hours *= FAMILIARITY_DISCOUNT
        hours = max(2, round(hours))
        start, elapsed = elapsed, elapsed + hours
        running[sid] = n.to_level

        if n.induced_by:
            names = ", ".join(sorted({catalog.skills[d].name for d in n.induced_by}))
            reason = (
                f"Prerequisite for {names}. "
                "Getting to Beginner first makes those steps faster."
            )
        else:
            q = required[sid]
            reason = (
                f"{target.title} needs {skill.name} at {LEVEL_LABELS[q.level]} level, "
                f"importance {q.importance} of 5. "
                + (
                    "This is new for you."
                    if n.from_level == 0
                    else f"You're at {LEVEL_LABELS[n.from_level]}."
                )
            )
            if len(desc[sid]):
                reason += (
                    f" Unlocks {len(desc[sid])} later "
                    f"step{'s' if len(desc[sid]) > 1 else ''}."
                )
            if skill.category in prefs.interests:
                reason += (
                    " Matches your interest in "
                    f"{_lower_first(catalog.categories[skill.category])}."
                )

        steps.append({
            "order": i,
            "skillId": sid,
            "name": skill.name,
            "category": skill.category,
            "fromLevel": n.from_level,
            "toLevel": n.to_level,
            "fromLabel": LEVEL_LABELS[n.from_level],
            "toLabel": LEVEL_LABELS[n.to_level],
            "hours": hours,
            "startWeek": int(start // prefs.hours_per_week) + 1,
            "endWeek": max(1, math.ceil(elapsed / prefs.hours_per_week)),
            "prerequisiteFor": sorted(n.induced_by),
            "dependsOn": sorted(n.deps),
            "reason": reason,
            "resources": pick_resources(sid, n.from_level, n.to_level, catalog, prefs)
            + [practice_project(sid, n.to_level, hours, catalog)],
        })
        projection.append({
            "week": steps[-1]["endWeek"],
            "readiness": readiness(running, target.requirements),
        })

    milestones = _milestones(steps, projection)
    for m in milestones:
        for order_no in m["stepOrders"]:
            steps[order_no - 1]["phase"] = m["title"]

    total_hours = round(elapsed)
    return {
        "steps": steps,
        "milestones": milestones,
        "projection": projection,
        "totalHours": total_hours,
        "totalWeeks": math.ceil(elapsed / prefs.hours_per_week) if steps else 0,
        "hoursPerWeek": prefs.hours_per_week,
        "pace": prefs.pace,
    }


def _milestones(steps: list[dict], projection: list[dict]) -> list[dict]:
    if not steps:
        return []
    total = sum(s["hours"] for s in steps)
    n_phases = min(3, len(steps))
    names = ["Foundations", "Core skills", "Role-ready"][3 - n_phases:]
    groups: list[list[int]] = [[] for _ in range(n_phases)]
    elapsed = 0.0
    for idx, s in enumerate(steps):
        midpoint = elapsed + s["hours"] / 2
        g = min(n_phases - 1, int(midpoint / total * n_phases))
        # never leave an earlier phase empty
        while g > 0 and not groups[g - 1]:
            g -= 1
        groups[g].append(idx)
        elapsed += s["hours"]
    milestones = []
    for name, idxs in zip(names, groups):
        if not idxs:
            continue
        last = idxs[-1]
        milestones.append({
            "title": name,
            "week": steps[last]["endWeek"],
            "stepOrders": [steps[i]["order"] for i in idxs],
            "skills": [steps[i]["name"] for i in idxs],
            "readiness": projection[last + 1]["readiness"],
        })
    return milestones


def suggest_electives(levels: dict[str, int], target: TargetProfile, plan_ids: set[str],
                      catalog: Catalog, prefs: Preferences) -> list[dict]:
    """Interest-driven skills outside the target role, kept out of the core pathway (MVP scope)."""
    required = {q.skill_id for q in target.requirements}
    out = []
    for sid, skill in catalog.skills.items():
        if skill.category not in prefs.interests or sid in required or sid in plan_ids:
            continue
        if levels.get(sid, 0) >= 3:
            continue
        prereqs_met = all(levels.get(p, 0) >= PREREQ_LEVEL for p in skill.prerequisites)
        out.append({
            "skillId": sid,
            "name": skill.name,
            "category": skill.category,
            "ready": prereqs_met,
            "why": f"Fits your interest in {_lower_first(catalog.categories[skill.category])}"
            + (
                ""
                if prereqs_met
                else "; needs "
                + ", ".join(
                    catalog.skills[p].name
                    for p in skill.prerequisites
                    if levels.get(p, 0) < PREREQ_LEVEL
                )
            ),
        })
    out.sort(key=lambda e: (not e["ready"], e["name"]))
    return out[:3]
