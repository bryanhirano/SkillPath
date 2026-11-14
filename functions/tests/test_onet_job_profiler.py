import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from skillpath.onet_job_profiler import (
    EducationEntry,
    JobEngine,
    Knowledge,
    OccupationProfile,
    PROFILE_SECTIONS,
    Skill,
    Task,
    TechnologyCategory,
    TechnologyExample,
    WorkActivity,
)


class GetOccupationProfileTests(unittest.TestCase):
    def test_returns_flattened_profile_sections(self) -> None:
        responses = [
            {
                "response": [
                    {
                        "title": "Bachelor's degree",
                        "percentage_of_respondents": 88,
                    }
                ],
                "end": 1,
            },
            {
                "activity": [{"title": "Write code", "related": "api-url"}],
                "end": 1,
            },
            {
                "element": [
                    {
                        "name": "Programming",
                        "description": "Write programs.",
                        "importance": 94,
                        "related": "api-url",
                    }
                ],
                "end": 1,
            },
            {
                "element": [
                    {
                        "name": "Computers and electronics",
                        "description": "Knowledge of computers.",
                        "importance": 97,
                    }
                ],
                "end": 1,
            },
            {
                "task": [
                    {
                        "title": "Write programs",
                        "importance": 86,
                        "category": "Core",
                        "related": "api-url",
                    }
                ],
                "end": 1,
            },
            {
                "category": [
                    {
                        "title": "Programming languages",
                        "example": [
                            {"title": "Python", "hot_technology": True, "href": "url"}
                        ],
                        "example_more": [{"title": "Ruby", "href": "url"}],
                    }
                ],
                "start": 1,
                "end": 1,
                "total": 1,
            },
        ]
        engine = JobEngine(api_key="test-key")

        with (
            patch.object(engine, "_get_occupation_title", return_value="Programmer"),
            patch.object(engine, "_get_section", side_effect=responses),
        ):
            profile = engine.get_occupation_profile("15-1251.00")

        self.assertIsInstance(profile, OccupationProfile)
        self.assertEqual(profile.occupation_title, "Programmer")
        self.assertEqual(
            profile.education,
            [EducationEntry(title="Bachelor's degree", percentage_of_respondents=88)],
        )
        self.assertEqual(
            profile.detailed_work_activities, [WorkActivity(title="Write code")]
        )
        self.assertEqual(
            profile.skills,
            [Skill(name="Programming", description="Write programs.", importance=94)],
        )
        self.assertEqual(
            profile.knowledge,
            [
                Knowledge(
                    name="Computers and electronics",
                    description="Knowledge of computers.",
                    importance=97,
                )
            ],
        )
        self.assertEqual(
            profile.tasks, [Task(title="Write programs", importance=86, category="Core")]
        )
        self.assertEqual(
            profile.technology_skills,
            [
                TechnologyCategory(
                    category="Programming languages",
                    examples=[
                        TechnologyExample(title="Python", hot_technology=True),
                        TechnologyExample(title="Ruby", hot_technology=False),
                    ],
                )
            ],
        )
        self.assertFalse(hasattr(profile.detailed_work_activities[0], "related"))
        self.assertFalse(hasattr(profile.technology_skills[0].examples[0], "href"))
        serialized = json.loads(json.dumps(asdict(profile)))
        self.assertEqual(serialized["skills"][0]["name"], "Programming")
        self.assertEqual(
            set(serialized),
            {
                "soc_code",
                "occupation_title",
                "source",
                *PROFILE_SECTIONS,
            },
        )


if __name__ == "__main__":
    unittest.main()
