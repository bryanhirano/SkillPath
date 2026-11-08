"""Skill, role and learning-resource catalog (subproblem 1: skill and role modeling).

The catalog is loaded once per function instance from the JSON files in ``data/``.
Swap those files for an O*NET-derived import without touching the rest of the engine.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

LEVEL_LABELS = {
    0: "None",
    1: "Awareness",
    2: "Beginner",
    3: "Intermediate",
    4: "Advanced",
    5: "Expert",
}
MIN_LEVEL, MAX_LEVEL = 0, 5


@dataclass(frozen=True)
class Skill:
    """A normalized skill and its learning metadata."""

    id: str
    name: str
    category: str
    aliases: tuple[str, ...]
    prerequisites: tuple[str, ...]
    hours_per_level: float


@dataclass(frozen=True)
class Requirement:
    """The proficiency level and importance a role assigns to a skill."""

    skill_id: str
    level: int
    importance: int


@dataclass(frozen=True)
class Role:
    """A target occupation and its required skills."""

    id: str
    title: str
    onet_code: str | None
    onet_title: str | None
    requirements: tuple[Requirement, ...]


@dataclass(frozen=True)
class Resource:  # pylint: disable=too-many-instance-attributes
    """A learning resource and the skills and levels it covers."""

    id: str
    title: str
    provider: str
    url: str | None
    skills: tuple[str, ...]
    min_level: int
    max_level: int
    format: str
    hours: float
    cost: str


@dataclass
class Catalog:
    """In-memory skills, roles, resources, and precomputed skill indexes."""

    categories: dict[str, str]
    skills: dict[str, Skill]
    roles: dict[str, Role]
    resources: list[Resource]
    _alias_index: dict[str, str] = field(default_factory=dict, repr=False)
    _alias_pattern: re.Pattern | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        """Build lookup indexes from each skill's name and aliases."""
        for skill in self.skills.values():
            for alias in (skill.name, *skill.aliases):
                self._alias_index.setdefault(normalize_text(alias), skill.id)
        # Longest aliases first so "machine learning" wins over "ml"-style fragments.
        aliases = sorted(self._alias_index, key=len, reverse=True)
        body = "|".join(re.escape(a) for a in aliases)
        # Custom boundaries: aliases may contain punctuation ("ci/cd", "node.js", "security+").
        self._alias_pattern = re.compile(rf"(?<![\w+#])(?:{body})(?![\w+#]|\.\w)", re.IGNORECASE)

    @property
    def alias_index(self) -> dict[str, str]:
        """Return the normalized alias-to-skill index."""
        return self._alias_index

    @property
    def alias_pattern(self) -> re.Pattern:
        """Return the compiled pattern that matches catalog aliases."""
        assert self._alias_pattern is not None
        return self._alias_pattern

    def resolve_alias(self, text: str) -> str | None:
        """Resolve an exact normalized alias to its skill identifier."""
        return self._alias_index.get(normalize_text(text))

    def public_skills(self) -> list[dict]:
        """Return skills in the public API representation."""
        return [
            {
                "id": s.id,
                "name": s.name,
                "category": s.category,
                "prerequisites": list(s.prerequisites),
            }
            for s in self.skills.values()
        ]

    def public_roles(self) -> list[dict]:
        """Return roles and their requirements in the public API representation."""
        return [
            {
                "id": r.id,
                "title": r.title,
                "onetCode": r.onet_code,
                "onetTitle": r.onet_title,
                "requirements": [
                    {"skillId": q.skill_id, "level": q.level, "importance": q.importance}
                    for q in r.requirements
                ],
            }
            for r in self.roles.values()
        ]

    def to_public(self) -> dict:
        """Return the catalog data exposed to clients."""
        return {
            "categories": self.categories,
            "levels": LEVEL_LABELS,
            "skills": self.public_skills(),
            "roles": self.public_roles(),
        }

def normalize_text(text: str) -> str:
    """Normalize text for case- and whitespace-insensitive matching."""
    return re.sub(r"\s+", " ", text.strip().lower())


def _load_json(name: str) -> dict:
    """Load a catalog JSON document from the package data directory."""
    with open(DATA_DIR / name, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def load_catalog() -> Catalog:
    """Load, construct, validate, and cache the skill catalog."""
    skills_doc = _load_json("skills.json")
    roles_doc = _load_json("roles.json")
    resources_doc = _load_json("resources.json")

    skills = {
        s["id"]: Skill(
            id=s["id"],
            name=s["name"],
            category=s["category"],
            aliases=tuple(s.get("aliases", [])),
            prerequisites=tuple(s.get("prerequisites", [])),
            hours_per_level=float(s.get("hoursPerLevel", 15)),
        )
        for s in skills_doc["skills"]
    }
    roles = {
        r["id"]: Role(
            id=r["id"],
            title=r["title"],
            onet_code=r.get("onetCode"),
            onet_title=r.get("onetTitle"),
            requirements=tuple(
                Requirement(q["skillId"], int(q["level"]), int(q["importance"]))
                for q in r["requirements"]
            ),
        )
        for r in roles_doc["roles"]
    }
    resources = [
        Resource(
            id=x["id"],
            title=x["title"],
            provider=x["provider"],
            url=x.get("url"),
            skills=tuple(x["skills"]),
            min_level=int(x["levels"][0]),
            max_level=int(x["levels"][1]),
            format=x["format"],
            hours=float(x.get("hours", 0)),
            cost=x.get("cost", "free"),
        )
        for x in resources_doc["resources"]
    ]
    catalog = Catalog(skills_doc["categories"], skills, roles, resources)
    validate_catalog(catalog)
    return catalog


def validate_catalog(catalog: Catalog) -> None:
    """Fail fast on dangling references or prerequisite cycles in the seed data."""
    for skill in catalog.skills.values():
        if skill.category not in catalog.categories:
            raise ValueError(f"Skill {skill.id} has unknown category {skill.category}")
        for p in skill.prerequisites:
            if p not in catalog.skills:
                raise ValueError(f"Skill {skill.id} has unknown prerequisite {p}")
    for role in catalog.roles.values():
        for q in role.requirements:
            if q.skill_id not in catalog.skills:
                raise ValueError(f"Role {role.id} requires unknown skill {q.skill_id}")
    for res in catalog.resources:
        for s in res.skills:
            if s not in catalog.skills:
                raise ValueError(f"Resource {res.id} references unknown skill {s}")

    visiting: set[str] = set()
    done: set[str] = set()

    def visit(sid: str, trail: list[str]) -> None:
        if sid in done:
            return
        if sid in visiting:
            raise ValueError("Prerequisite cycle: " + " -> ".join(trail + [sid]))
        visiting.add(sid)
        for p in catalog.skills[sid].prerequisites:
            visit(p, trail + [sid])
        visiting.discard(sid)
        done.add(sid)

    for sid in catalog.skills:
        visit(sid, [])
