"""Checks that the data files are where the code expects them."""
import unittest

from skillpath.catalog import load_catalog
from skillpath.onet_job_profiler import CSV_PATH, JobEngine


class DataPathTests(unittest.TestCase):
    def test_real_catalog_loads(self):
        catalog = load_catalog()
        self.assertIn("software-developer", catalog.roles)

    def test_role_onet_codes_exist_in_occupation_csv(self):
        self.assertTrue(CSV_PATH.exists(), CSV_PATH)
        engine = JobEngine()
        for role in load_catalog().roles.values():
            if role.onet_code:
                self.assertIsNotNone(engine._get_occupation_title(role.onet_code), role.id)


if __name__ == "__main__":
    unittest.main()
