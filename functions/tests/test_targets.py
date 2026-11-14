import unittest

from skillpath.catalog import Catalog, Requirement, Role, Skill, validate_catalog
from skillpath.gap import InputError
from skillpath.targets import role_options, select_target


def make_catalog() -> Catalog:
    def skill(sid, name, cat, aliases=(), prereqs=()):
        return Skill(sid, name, cat, tuple(aliases), tuple(prereqs), 15)

    skills = {
        "python": skill("python", "Python", "programming"),
        "sql": skill("sql", "SQL", "data", ["postgresql"]),
        "ml": skill("ml", "Machine Learning", "ml", ["machine learning"], ["python"]),
        "stats": skill("stats", "Statistics", "data"),
    }
    roles = {
        "web-dev": Role("web-dev", "Web Developer", "15-1254.00", "Web Developers",
                        (Requirement("python", 3, 4),)),
        "data-sci": Role("data-sci", "Data Scientist", "15-2051.00", "Data Scientists",
                         (Requirement("python", 3, 5), Requirement("ml", 3, 4),
                          Requirement("sql", 3, 3))),
    }
    cats = {"programming": "Programming", "data": "Data", "ml": "Machine learning"}
    cat = Catalog(cats, skills, roles, [])
    validate_catalog(cat)
    return cat


JD = ("We need a data analyst. Required: strong SQL and PostgreSQL experience. "
      "You must know Statistics. Python is a plus.")


class TargetTests(unittest.TestCase):
    def setUp(self):
        self.catalog = make_catalog()

    def test_role_options_sorted_with_onet(self):
        opts = role_options(self.catalog)
        self.assertEqual([o["title"] for o in opts], ["Data Scientist", "Web Developer"])
        self.assertEqual(opts[0]["onetCode"], "15-2051.00")
        self.assertEqual(opts[0]["requirementCount"], 3)

    def test_role_without_skills_saves_but_no_analysis(self):
        out = select_target({"target": {"roleId": "data-sci"}}, self.catalog)
        self.assertIsNone(out["analysis"])
        self.assertEqual(out["target"],
                         {"roleId": "data-sci", "resolvedTitle": "Data Scientist", "custom": False})

    def test_role_with_skills_runs_analysis(self):
        out = select_target(
            {"target": {"roleId": "data-sci"}, "skills": [{"skillId": "python", "level": 3}]},
            self.catalog,
        )
        a = out["analysis"]
        self.assertEqual(a["target"]["id"], "data-sci")
        self.assertEqual({g["skillId"] for g in a["gaps"]}, {"ml", "sql"})
        self.assertGreater(a["readiness"], 0)
        self.assertTrue(a["pathway"]["steps"])

    def test_unknown_role_rejected(self):
        with self.assertRaises(InputError):
            select_target({"target": {"roleId": "astronaut"}}, self.catalog)

    def test_missing_target_rejected(self):
        for bad in ({}, {"target": None}, {"target": {"jobDescription": "  "}}, "x"):
            with self.assertRaises(InputError):
                select_target(bad if isinstance(bad, dict) else bad, self.catalog)

    def test_job_description_target(self):
        calls = []
        out = select_target(
            {"target": {"title": " Data Analyst ", "jobDescription": JD},
             "skills": {"sql": 2}},
            self.catalog,
            tagger_factory=lambda: calls.append(1),
        )
        self.assertEqual(calls, [1])  # tagger loaded only for a job description
        self.assertEqual(out["target"]["resolvedTitle"], "Data Analyst")
        self.assertTrue(out["target"]["custom"])
        req_ids = {r["skillId"] for r in out["analysis"]["requirements"]}
        self.assertTrue({"sql", "stats"} <= req_ids)

    def test_role_does_not_load_tagger(self):
        def boom():
            raise AssertionError("tagger should not load for catalog roles")
        select_target({"target": {"roleId": "web-dev"}}, self.catalog, tagger_factory=boom)


if __name__ == "__main__":
    unittest.main()
